const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");
const accountingService = require("./accounting.service");

const ENTRY_REVERSE_POLICY = "accounting.entry.reverse@1";

function validReason(value) {
  return Boolean(value && String(value).trim().length >= 5);
}

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("accounting.entry.reverse", "1", ({ input, idempotencyKey }) => {
  if (!input?.entryId || !input?.reversalDate) {
    return { allowed: false, statusCode: 400, code: "accounting_reversal.data_required", reason: "L’écriture et la date du renversement sont obligatoires." };
  }
  if (!validIdempotency(idempotencyKey)) {
    return { allowed: false, statusCode: 400, code: "accounting_reversal.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  }
  if (!validReason(input.reason)) {
    return { allowed: false, statusCode: 400, code: "accounting_reversal.reason_required", reason: "La raison du renversement est obligatoire." };
  }
  return { allowed: true, code: "accounting_reversal.valid" };
});

async function reversePostedEntry({ organisationId, entryId, reversalDate, reason, idempotencyKey, reversedBy }) {
  const transaction = await executeTransaction({
    type: "accounting.entry.reverse",
    organisationId: organisationValue(organisationId),
    actorUserId: reversedBy,
    idempotencyKey,
    policies: [ENTRY_REVERSE_POLICY],
    input: { entryId, reversalDate, reason },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId, idempotencyKey: key, input }) => {
      const existing = await client.query(
        `SELECT * FROM accounting_entries WHERE organisation_id=$1 AND idempotency_key=$2 FOR UPDATE`,
        [orgId, String(key).trim()],
      );
      if (existing.rows[0]) return { duplicate: true, reversal: existing.rows[0] };

      const originalResult = await client.query(
        `SELECT e.*, j.code AS journal_code, j.name AS journal_name
         FROM accounting_entries e JOIN accounting_journals j ON j.id=e.journal_id AND j.organisation_id=e.organisation_id
         WHERE e.organisation_id=$1 AND e.id=$2 AND e.status IN ('posted','reversed') FOR UPDATE`,
        [orgId, input.entryId],
      );
      const original = originalResult.rows[0];
      if (!original) return null;
      if (original.reversed_by_entry_id) {
        const reversal = await client.query(`SELECT * FROM accounting_entries WHERE organisation_id=$1 AND id=$2`, [orgId, original.reversed_by_entry_id]);
        return { duplicate: true, reversal: reversal.rows[0], original };
      }

      const linesResult = await client.query(
        `SELECT account_id AS "accountId", description, credit::numeric AS debit, debit::numeric AS credit
         FROM accounting_entry_lines WHERE organisation_id=$1 AND entry_id=$2 ORDER BY id`,
        [orgId, original.id],
      );
      const validated = accountingService.validateEntryLines(linesResult.rows);
      const inserted = await client.query(
        `INSERT INTO accounting_entries
         (organisation_id,journal_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,created_by,
          idempotency_key,adjustment_kind,reversal_of_entry_id,reversal_reason)
         VALUES ($1,$2,$3,$4,$5,'accounting_reversal',$6,'posted',NOW(),$7,$8,'reversal',$9,$10)
         RETURNING *`,
        [orgId, original.journal_id, `REV-${original.entry_number}-${Date.now()}`, input.reversalDate,
          String(input.reason).trim(), String(original.id), actorUserId || null, String(key).trim(), original.id, String(input.reason).trim()],
      );
      const reversal = inserted.rows[0];
      for (const line of validated.lines) {
        await client.query(
          `INSERT INTO accounting_entry_lines (organisation_id,entry_id,account_id,description,debit,credit)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [orgId, reversal.id, line.accountId, line.description || `Renversement de ${original.entry_number}`, line.debit, line.credit],
        );
      }
      await client.query(
        `UPDATE accounting_entries SET reversed_by_entry_id=$3, reversal_reason=$4
         WHERE organisation_id=$1 AND id=$2`,
        [orgId, original.id, reversal.id, String(input.reason).trim()],
      );

      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "accounting.entry.reversed",
        aggregateType: "accounting_entry",
        aggregateId: original.id,
        actorUserId,
        correlationId,
        occurredAt: input.reversalDate,
        metadata: { transactionId, policyVersions: [ENTRY_REVERSE_POLICY], idempotencyKey: String(key).trim() },
        payload: { originalEntryId: original.id, reversalEntryId: reversal.id, debit: validated.debit, credit: validated.credit, reason: input.reason },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [
          { code: "accounting_reversal.balanced", passed: validated.debit === validated.credit, evidence: [{ debit: validated.debit, credit: validated.credit }] },
          { code: "accounting_reversal.original_preserved", passed: original.id !== reversal.id, evidence: [{ originalEntryId: original.id, reversalEntryId: reversal.id }] },
          { code: "accounting_reversal.linked", passed: Number(reversal.reversal_of_entry_id) === Number(original.id), evidence: [{ reversalOfEntryId: reversal.reversal_of_entry_id }] },
          { code: "accounting_reversal.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id || null }] },
        ],
      });
      const graph = await persistGraphEdges(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        edges: [
          { from: { type: "accounting_entry", id: original.id }, relation: "reversed_by", to: { type: "accounting_entry", id: reversal.id }, provenance: { eventId: event.event_id } },
          { from: { type: "accounting_entry", id: reversal.id }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } },
          { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: "accounting_entry", id: reversal.id }, provenance: { transactionId } },
        ],
      });
      return { duplicate: false, original: { ...original, reversed_by_entry_id: reversal.id }, reversal: { ...reversal, debit: validated.debit, credit: validated.credit }, event, trust, graph };
    },
    verify: async ({ result }) => {
      if (!result || result.duplicate) return;
      if (!result.reversal?.id || !result.event?.event_id || !result.trust?.assessmentId) throw new Error("Validation postérieure du renversement comptable incomplète.");
    },
  });
  return transaction.result ? { ...transaction.result, ct_mad: { transactionId: transaction.transactionId, correlationId: transaction.correlationId, status: transaction.status, policies: transaction.policyResults } } : null;
}

module.exports = { ENTRY_REVERSE_POLICY, validReason, validIdempotency, reversePostedEntry };
