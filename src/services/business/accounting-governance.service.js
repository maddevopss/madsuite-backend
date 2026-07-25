const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");
const accountingService = require("./accounting.service");

const PERIOD_CLOSE_POLICY = "accounting.period.close@1";
const PERIOD_REOPEN_POLICY = "accounting.period.reopen@1";
const ADJUSTMENT_POST_POLICY = "accounting.adjustment.post@1";
const ENTRY_REVERSE_POLICY = "accounting.entry.reverse@1";

function validReason(value) {
  return Boolean(value && String(value).trim().length >= 5);
}

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("accounting.period.close", "1", ({ input }) => {
  if (!input?.periodId) return { allowed: false, statusCode: 400, code: "accounting_period.required", reason: "Une période comptable est requise." };
  if (!validReason(input.reason)) return { allowed: false, statusCode: 400, code: "accounting_period.close_reason_required", reason: "Une raison de fermeture est obligatoire." };
  return { allowed: true, code: "accounting_period.close_valid" };
});

registerPolicy("accounting.period.reopen", "1", ({ input }) => {
  if (!input?.periodId) return { allowed: false, statusCode: 400, code: "accounting_period.required", reason: "Une période comptable est requise." };
  if (!validReason(input.reason)) return { allowed: false, statusCode: 400, code: "accounting_period.reopen_reason_required", reason: "Une raison de réouverture est obligatoire." };
  return { allowed: true, code: "accounting_period.reopen_valid" };
});

registerPolicy("accounting.adjustment.post", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "accounting_adjustment.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  if (!input?.entryDate || !input?.description) return { allowed: false, statusCode: 400, code: "accounting_adjustment.data_required", reason: "La date et la description sont obligatoires." };
  if (!validReason(input.reason)) return { allowed: false, statusCode: 400, code: "accounting_adjustment.reason_required", reason: "La raison de l’ajustement est obligatoire." };
  return { allowed: true, code: "accounting_adjustment.valid" };
});

registerPolicy("accounting.entry.reverse", "1", ({ input, idempotencyKey }) => {
  if (!input?.entryId || !input?.reversalDate) return { allowed: false, statusCode: 400, code: "accounting_reversal.data_required", reason: "L’écriture et la date de renversement sont obligatoires." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "accounting_reversal.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  if (!validReason(input.reason)) return { allowed: false, statusCode: 400, code: "accounting_reversal.reason_required", reason: "La raison du renversement est obligatoire." };
  return { allowed: true, code: "accounting_reversal.valid" };
});

async function closePeriod({ periodId, organisationId, reason, closedBy }) {
  const transaction = await executeTransaction({
    type: "accounting.period.close",
    organisationId: organisationValue(organisationId),
    actorUserId: closedBy,
    policies: [PERIOD_CLOSE_POLICY],
    input: { periodId, reason },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId, input }) => {
      const periodResult = await client.query(
        `SELECT * FROM accounting_periods WHERE organisation_id=$1 AND id=$2 FOR UPDATE`,
        [orgId, input.periodId],
      );
      const period = periodResult.rows[0];
      if (!period) return null;
      if (period.status === "closed") return { duplicate: true, period };

      const draftResult = await client.query(
        `SELECT COUNT(*)::int AS count FROM accounting_entries
         WHERE organisation_id=$1 AND entry_date BETWEEN $2 AND $3 AND status='draft'`,
        [orgId, period.starts_on, period.ends_on],
      );
      if (draftResult.rows[0].count > 0) {
        throw Object.assign(new Error("La période contient encore des écritures en brouillon."), { statusCode: 409, details: { draftCount: draftResult.rows[0].count } });
      }

      const totals = await client.query(
        `SELECT COALESCE(SUM(l.debit),0)::numeric AS debit, COALESCE(SUM(l.credit),0)::numeric AS credit
         FROM accounting_entries e
         JOIN accounting_entry_lines l ON l.entry_id=e.id AND l.organisation_id=e.organisation_id
         WHERE e.organisation_id=$1 AND e.entry_date BETWEEN $2 AND $3 AND e.status IN ('posted','reversed')`,
        [orgId, period.starts_on, period.ends_on],
      );
      const debit = Number(totals.rows[0].debit || 0);
      const credit = Number(totals.rows[0].credit || 0);
      if (Number(debit.toFixed(2)) !== Number(credit.toFixed(2))) {
        throw Object.assign(new Error("La période ne peut pas être fermée car la balance est déséquilibrée."), { statusCode: 409, details: { debit, credit } });
      }

      const updated = await client.query(
        `UPDATE accounting_periods
         SET status='closed', closed_at=NOW(), closed_by=$3, close_reason=$4
         WHERE organisation_id=$1 AND id=$2 AND status='open'
         RETURNING *`,
        [orgId, period.id, actorUserId || null, String(input.reason).trim()],
      );
      const closed = updated.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "accounting.period.closed",
        aggregateType: "accounting_period",
        aggregateId: period.id,
        actorUserId,
        correlationId,
        metadata: { transactionId, policyVersions: [PERIOD_CLOSE_POLICY] },
        payload: { periodId: period.id, startsOn: period.starts_on, endsOn: period.ends_on, debit, credit, reason: input.reason },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [
          { code: "accounting_period.no_drafts", passed: draftResult.rows[0].count === 0, evidence: [{ draftCount: draftResult.rows[0].count }] },
          { code: "accounting_period.balanced", passed: debit.toFixed(2) === credit.toFixed(2), evidence: [{ debit, credit }] },
          { code: "accounting_period.closed", passed: closed?.status === "closed", evidence: [{ status: closed?.status || null }] },
          { code: "accounting_period.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id || null }] },
        ],
      });
      const graph = await persistGraphEdges(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        edges: [
          { from: { type: "accounting_period", id: period.id }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } },
          { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: "accounting_period", id: period.id }, provenance: { transactionId } },
        ],
      });
      return { duplicate: false, period: closed, totals: { debit, credit }, event, trust, graph };
    },
    verify: async ({ result }) => {
      if (!result || result.duplicate) return;
      if (result.period?.status !== "closed" || !result.event?.event_id || !result.trust?.assessmentId) throw new Error("Validation postérieure de la fermeture comptable incomplète.");
    },
  });
  return transaction.result ? { ...transaction.result, ct_mad: { transactionId: transaction.transactionId, correlationId: transaction.correlationId, status: transaction.status, policies: transaction.policyResults } } : null;
}

async function reopenPeriod({ periodId, organisationId, reason, reopenedBy }) {
  const transaction = await executeTransaction({
    type: "accounting.period.reopen",
    organisationId: organisationValue(organisationId),
    actorUserId: reopenedBy,
    policies: [PERIOD_REOPEN_POLICY],
    input: { periodId, reason },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId, input }) => {
      const result = await client.query(`SELECT * FROM accounting_periods WHERE organisation_id=$1 AND id=$2 FOR UPDATE`, [orgId, input.periodId]);
      const period = result.rows[0];
      if (!period) return null;
      if (period.status === "open") return { duplicate: true, period };
      const updated = await client.query(
        `UPDATE accounting_periods SET status='open', reopened_at=NOW(), reopened_by=$3, reopen_reason=$4
         WHERE organisation_id=$1 AND id=$2 AND status='closed' RETURNING *`,
        [orgId, period.id, actorUserId || null, String(input.reason).trim()],
      );
      const reopened = updated.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId, eventType: "accounting.period.reopened", aggregateType: "accounting_period", aggregateId: period.id,
        actorUserId, correlationId, metadata: { transactionId, policyVersions: [PERIOD_REOPEN_POLICY] }, payload: { periodId: period.id, reason: input.reason },
      });
      const trust = await persistTrustAssessment(client, { organisationId: orgId, transactionId, correlationId, checks: [
        { code: "accounting_period.reopened", passed: reopened?.status === "open", evidence: [{ status: reopened?.status || null }] },
        { code: "accounting_period.reopen_event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id || null }] },
      ] });
      const graph = await persistGraphEdges(client, { organisationId: orgId, transactionId, correlationId, edges: [
        { from: { type: "accounting_period", id: period.id }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } },
        { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: "accounting_period", id: period.id }, provenance: { transactionId } },
      ] });
      return { duplicate: false, period: reopened, event, trust, graph };
    },
    verify: async ({ result }) => { if (!result || result.duplicate) return; if (result.period?.status !== "open" || !result.event?.event_id) throw new Error("Validation postérieure de la réouverture comptable incomplète."); },
  });
  return transaction.result ? { ...transaction.result, ct_mad: { transactionId: transaction.transactionId, correlationId: transaction.correlationId, status: transaction.status, policies: transaction.policyResults } } : null;
}

async function createPostedAdjustment({ organisationId, userId, idempotencyKey, entryDate, description, reason, lines, journalCode = "AJU", journalName = "Journal des ajustements", adjustmentKind = "manual" }) {
  const transaction = await executeTransaction({
    type: "accounting.adjustment.post",
    organisationId: organisationValue(organisationId), actorUserId: userId, idempotencyKey,
    policies: [ADJUSTMENT_POST_POLICY], input: { entryDate, description, reason, lines, journalCode, journalName, adjustmentKind },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId, idempotencyKey: key, input }) => {
      const existing = await client.query(`SELECT * FROM accounting_entries WHERE organisation_id=$1 AND idempotency_key=$2 FOR UPDATE`, [orgId, String(key).trim()]);
      if (existing.rows[0]) return { duplicate: true, entry: existing.rows[0] };
      const validated = accountingService.validateEntryLines(input.lines);
      await client.query(`INSERT INTO accounting_journals (organisation_id,code,name,journal_type) VALUES ($1,$2,$3,'general') ON CONFLICT (organisation_id,code) DO NOTHING`, [orgId, input.journalCode, input.journalName]);
      const journal = await client.query(`SELECT id FROM accounting_journals WHERE organisation_id=$1 AND code=$2`, [orgId, input.journalCode]);
      const inserted = await client.query(
        `INSERT INTO accounting_entries
         (organisation_id,journal_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,created_by,idempotency_key,adjustment_kind)
         VALUES ($1,$2,$3,$4,$5,'accounting_adjustment',$6,'posted',NOW(),$7,$8,$9) RETURNING *`,
        [orgId, journal.rows[0].id, `AJU-${Date.now()}`, input.entryDate, input.description, transactionId, actorUserId || null, String(key).trim(), input.adjustmentKind],
      );
      const entry = inserted.rows[0];
      for (const line of validated.lines) {
        await client.query(`INSERT INTO accounting_entry_lines (organisation_id,entry_id,account_id,description,debit,credit) VALUES ($1,$2,$3,$4,$5,$6)`, [orgId, entry.id, line.accountId, line.description || null, line.debit, line.credit]);
      }
      const event = await appendEvent(client, { organisationId: orgId, eventType: "accounting.adjustment.posted", aggregateType: "accounting_entry", aggregateId: entry.id, actorUserId, correlationId, occurredAt: input.entryDate, metadata: { transactionId, policyVersions: [ADJUSTMENT_POST_POLICY], idempotencyKey: String(key).trim() }, payload: { entryId: entry.id, debit: validated.debit, credit: validated.credit, reason: input.reason, adjustmentKind: input.adjustmentKind } });
      const trust = await persistTrustAssessment(client, { organisationId: orgId, transactionId, correlationId, checks: [
        { code: "accounting_adjustment.balanced", passed: validated.debit === validated.credit, evidence: [{ debit: validated.debit, credit: validated.credit }] },
        { code: "accounting_adjustment.posted", passed: entry.status === "posted", evidence: [{ entryId: entry.id, status: entry.status }] },
        { code: "accounting_adjustment.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id || null }] },
      ] });
      const graph = await persistGraphEdges(client, { organisationId: orgId, transactionId, correlationId, edges: [
        { from: { type: "accounting_entry", id: entry.id }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } },
        { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: "accounting_entry", id: entry.id }, provenance: { transactionId } },
      ] });
      return { duplicate: false, entry: { ...entry, debit: validated.debit, credit: validated.credit }, event, trust, graph };
    },
    verify: async ({ result }) => { if (!result || result.duplicate) return; if (result.entry?.status !== "posted" || !result.event?.event_id || !result.trust?.assessmentId) throw new Error("Validation postérieure de l’ajustement comptable incomplète."); },
  });
  return transaction.result ? { ...transaction.result, ct_mad: { transactionId: transaction.transactionId, correlationId: transaction.correlationId, status: transaction.status, policies: transaction.policyResults } } : null;
}

async function explainEntry(db, organisationId, entryId) {
  const entryResult = await db.query(
    `SELECT e.*, j.code AS journal_code, j.name AS journal_name, p.fiscal_year, p.period_number, p.status AS period_status
     FROM accounting_entries e
     JOIN accounting_journals j ON j.id=e.journal_id AND j.organisation_id=e.organisation_id
     LEFT JOIN accounting_periods p ON p.id=e.period_id AND p.organisation_id=e.organisation_id
     WHERE e.organisation_id=$1 AND e.id=$2`,
    [organisationId, entryId],
  );
  const entry = entryResult.rows[0];
  if (!entry) return null;
  const lines = await db.query(
    `SELECT l.*, a.code AS account_code, a.name AS account_name, a.account_type
     FROM accounting_entry_lines l JOIN accounting_accounts a ON a.id=l.account_id AND a.organisation_id=l.organisation_id
     WHERE l.organisation_id=$1 AND l.entry_id=$2 ORDER BY l.id`,
    [organisationId, entryId],
  );
  const events = await db.query(
    `SELECT * FROM business_events WHERE organisation_id=$1
     AND ((aggregate_type='accounting_entry' AND aggregate_id=$2::text)
       OR payload->>'accountingEntryId'=$2::text OR payload->>'entryId'=$2::text)
     ORDER BY occurred_at, event_id`,
    [organisationId, String(entryId)],
  );
  const transactionIds = [...new Set(events.rows.map((event) => event.metadata?.transactionId).filter(Boolean))];
  const trust = transactionIds.length ? await db.query(
    `SELECT a.*, COALESCE(json_agg(c ORDER BY c.id) FILTER (WHERE c.id IS NOT NULL),'[]') AS checks
     FROM madtrust_assessments a LEFT JOIN madtrust_checks c ON c.assessment_id=a.id AND c.organisation_id=a.organisation_id
     WHERE a.organisation_id=$1 AND a.transaction_id=ANY($2::text[]) GROUP BY a.id ORDER BY a.created_at`,
    [organisationId, transactionIds],
  ) : { rows: [] };
  const source = entry.source_type && entry.source_id ? { type: entry.source_type, id: entry.source_id } : null;
  return { entry, lines: lines.rows, source, events: events.rows, trust: trust.rows, trace: { periodId: entry.period_id || null, transactionIds, eventIds: events.rows.map((event) => event.event_id), trustAssessmentIds: trust.rows.map((assessment) => assessment.id) } };
}

async function explainedStatements(db, organisationId, endDate) {
  const statements = await accountingService.statements(db, organisationId, endDate);
  const balances = await accountingService.trialBalance(db, organisationId, null, endDate);
  return {
    ...statements,
    accounts: balances.map((row) => ({ ...row, explain: { accountId: row.id, ledgerFilters: { accountId: row.id, endDate: endDate || null } } })),
    trace: { generatedFrom: "accounting_entries", statuses: ["posted", "reversed"], endDate: endDate || null },
  };
}

module.exports = {
  PERIOD_CLOSE_POLICY,
  PERIOD_REOPEN_POLICY,
  ADJUSTMENT_POST_POLICY,
  ENTRY_REVERSE_POLICY,
  validReason,
  validIdempotency,
  closePeriod,
  reopenPeriod,
  createPostedAdjustment,
  explainEntry,
  explainedStatements,
};
