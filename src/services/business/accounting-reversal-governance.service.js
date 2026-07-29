const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");
const accountingService = require("./accounting.service");
const { assertOpenAccountingPeriod } = require("./accounting-period-lock.service");

const ENTRY_REVERSE_POLICY = "accounting.entry.reverse@1";

function validReason(value) {
  return Boolean(value && String(value).trim().length >= 10);
}

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

function validationError(message, code) {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

function conflictError(message, code, details) {
  return Object.assign(new Error(message), { statusCode: 409, code, details });
}

function validateReversalPreviewCommand(command = {}) {
  const entryId = Number(command.entryId);
  if (!Number.isInteger(entryId) || entryId <= 0 || !command.reversalDate) {
    throw validationError("L’écriture et la date du renversement sont obligatoires.", "ACCOUNTING_REVERSAL_DATA_REQUIRED");
  }
  if (!validReason(command.reason)) {
    throw validationError("La justification du renversement doit contenir au moins 10 caractères.", "ACCOUNTING_REVERSAL_REASON_REQUIRED");
  }
  return {
    entryId,
    reversalDate: String(command.reversalDate),
    reason: String(command.reason).trim(),
  };
}

function validateReversalCommand(command = {}) {
  const preview = validateReversalPreviewCommand(command);
  if (command.confirmedByHuman !== true) {
    throw validationError("Une confirmation humaine explicite est obligatoire.", "ACCOUNTING_REVERSAL_CONFIRMATION_REQUIRED");
  }
  if (!validIdempotency(command.idempotencyKey)) {
    throw validationError("Une clé d’idempotence valide est obligatoire.", "ACCOUNTING_REVERSAL_IDEMPOTENCY_REQUIRED");
  }
  return {
    ...preview,
    idempotencyKey: String(command.idempotencyKey).trim(),
    confirmedByHuman: true,
  };
}

registerPolicy("accounting.entry.reverse", "1", ({ input, idempotencyKey }) => {
  if (!input?.entryId || !input?.reversalDate) {
    return { allowed: false, statusCode: 400, code: "accounting_reversal.data_required", reason: "L’écriture et la date du renversement sont obligatoires." };
  }
  if (input.confirmedByHuman !== true) {
    return { allowed: false, statusCode: 400, code: "accounting_reversal.confirmation_required", reason: "Une confirmation humaine explicite est obligatoire." };
  }
  if (!validIdempotency(idempotencyKey)) {
    return { allowed: false, statusCode: 400, code: "accounting_reversal.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  }
  if (!validReason(input.reason)) {
    return { allowed: false, statusCode: 400, code: "accounting_reversal.reason_required", reason: "La raison du renversement est obligatoire." };
  }
  return { allowed: true, code: "accounting_reversal.valid" };
});

async function loadReversibleEntry(db, organisationId, entryId, lock = false) {
  const result = await db.query(
    `SELECT e.*, j.code AS journal_code, j.name AS journal_name
     FROM accounting_entries e
     JOIN accounting_journals j ON j.id=e.journal_id AND j.organisation_id=e.organisation_id
     WHERE e.organisation_id=$1 AND e.id=$2 AND e.status IN ('posted','reversed')${lock ? " FOR UPDATE" : ""}`,
    [organisationId, entryId],
  );
  const original = result.rows[0];
  if (!original) return null;
  if (original.reversal_of_entry_id) {
    throw conflictError("Une écriture de renversement ne peut pas être renversée directement.", "ACCOUNTING_REVERSAL_OF_REVERSAL_FORBIDDEN", { entryId });
  }
  return original;
}

async function loadReversedLines(db, organisationId, entryId) {
  const linesResult = await db.query(
    `SELECT account_id AS "accountId", description, credit::numeric AS debit, debit::numeric AS credit
     FROM accounting_entry_lines WHERE organisation_id=$1 AND entry_id=$2 ORDER BY id`,
    [organisationId, entryId],
  );
  return accountingService.validateEntryLines(linesResult.rows);
}

async function previewPostedEntryReversal({ db, organisationId, entryId, reversalDate, reason }) {
  const command = validateReversalPreviewCommand({ entryId, reversalDate, reason });
  const original = await loadReversibleEntry(db, organisationId, command.entryId);
  if (!original) return null;
  if (original.reversed_by_entry_id) {
    throw conflictError("Cette écriture a déjà été renversée.", "ACCOUNTING_REVERSAL_ALREADY_REVERSED", {
      entryId: original.id,
      reversalEntryId: original.reversed_by_entry_id,
    });
  }
  const validated = await loadReversedLines(db, organisationId, original.id);
  return {
    mode: "preview",
    mutatesAccounting: false,
    requiresHumanConfirmation: true,
    original,
    proposedReversal: {
      reversalDate: command.reversalDate,
      description: command.reason,
      journalCode: original.journal_code,
      journalName: original.journal_name,
      lines: validated.lines,
      totals: { debit: validated.debit, credit: validated.credit },
    },
  };
}

async function reversePostedEntry({ organisationId, entryId, reversalDate, reason, idempotencyKey, reversedBy, confirmedByHuman }) {
  const command = validateReversalCommand({ entryId, reversalDate, reason, idempotencyKey, confirmedByHuman });
  const transaction = await executeTransaction({
    type: "accounting.entry.reverse",
    organisationId: organisationValue(organisationId),
    actorUserId: reversedBy,
    idempotencyKey: command.idempotencyKey,
    policies: [ENTRY_REVERSE_POLICY],
    input: command,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId, idempotencyKey: key, input }) => {
      const existing = await client.query(
        `SELECT * FROM accounting_entries WHERE organisation_id=$1 AND idempotency_key=$2 FOR UPDATE`,
        [orgId, String(key).trim()],
      );
      if (existing.rows[0]) return { duplicate: true, reversal: existing.rows[0] };

      await assertOpenAccountingPeriod(client, {
        organisationId: orgId,
        entryDate: input.reversalDate,
        operation: "accounting.entry.reverse",
      });

      const original = await loadReversibleEntry(client, orgId, input.entryId, true);
      if (!original) return null;
      if (original.reversed_by_entry_id) {
        const reversal = await client.query(`SELECT * FROM accounting_entries WHERE organisation_id=$1 AND id=$2`, [orgId, original.reversed_by_entry_id]);
        return { duplicate: true, reversal: reversal.rows[0], original };
      }

      const validated = await loadReversedLines(client, orgId, original.id);
      const inserted = await client.query(
        `INSERT INTO accounting_entries
         (organisation_id,journal_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,created_by,
          idempotency_key,adjustment_kind,reversal_of_entry_id,reversal_reason)
         VALUES ($1,$2,$3,$4,$5,'accounting_reversal',$6,'posted',NOW(),$7,$8,'reversal',$9,$10)
         RETURNING *`,
        [orgId, original.journal_id, `REV-${original.entry_number}-${Date.now()}`, input.reversalDate,
          input.reason, String(original.id), actorUserId || null, String(key).trim(), original.id, input.reason],
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
        [orgId, original.id, reversal.id, input.reason],
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
        payload: { originalEntryId: original.id, reversalEntryId: reversal.id, debit: validated.debit, credit: validated.credit, reason: input.reason, confirmedByHuman: true },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [
          { code: "accounting_reversal.balanced", passed: validated.debit === validated.credit, evidence: [{ debit: validated.debit, credit: validated.credit }] },
          { code: "accounting_reversal.original_preserved", passed: original.id !== reversal.id, evidence: [{ originalEntryId: original.id, reversalEntryId: reversal.id }] },
          { code: "accounting_reversal.linked", passed: Number(reversal.reversal_of_entry_id) === Number(original.id), evidence: [{ reversalOfEntryId: reversal.reversal_of_entry_id }] },
          { code: "accounting_reversal.human_confirmed", passed: input.confirmedByHuman === true, evidence: [{ actorUserId: actorUserId || null }] },
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
      const originalAfter = { ...original, reversed_by_entry_id: reversal.id, reversal_reason: input.reason };
      return {
        duplicate: false,
        confirmedByHuman: true,
        reason: input.reason,
        before: original,
        after: originalAfter,
        original: originalAfter,
        reversal: { ...reversal, debit: validated.debit, credit: validated.credit },
        event,
        trust,
        graph,
        proof: {
          actorUserId: actorUserId || null,
          idempotencyKey: String(key).trim(),
          originalEntryId: original.id,
          originalStatusBefore: original.status,
          reversalEntryId: reversal.id,
          linked: Number(reversal.reversal_of_entry_id) === Number(original.id),
          originalPreserved: original.id !== reversal.id,
        },
      };
    },
    verify: async ({ result }) => {
      if (!result || result.duplicate) return;
      if (!result.reversal?.id || !result.event?.event_id || !result.trust?.assessmentId || !result.confirmedByHuman) {
        throw new Error("Validation postérieure du renversement comptable incomplète.");
      }
    },
  });
  return transaction.result ? { ...transaction.result, ct_mad: { transactionId: transaction.transactionId, correlationId: transaction.correlationId, status: transaction.status, policies: transaction.policyResults } } : null;
}

module.exports = {
  ENTRY_REVERSE_POLICY,
  validReason,
  validIdempotency,
  validateReversalPreviewCommand,
  validateReversalCommand,
  loadReversibleEntry,
  loadReversedLines,
  previewPostedEntryReversal,
  reversePostedEntry,
};