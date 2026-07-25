const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");
const {
  ACCOUNT_CODES,
  loadAccounts,
  recordPostedEntry,
  recordSupplierBillAccounting,
} = require("./accounting-sync.service");

const APPROVE_POLICY = "supplier.bill.approve@1";
const CREDIT_POLICY = "supplier.bill.credit_note.post@1";
const VOID_POLICY = "supplier.bill.void@1";

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

function normalizeMoney(value, { allowZero = false } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) return null;
  return Number(amount.toFixed(2));
}

function ctResult(transaction) {
  if (!transaction.result) return null;
  return {
    ...transaction.result,
    ct_mad: {
      transactionId: transaction.transactionId,
      correlationId: transaction.correlationId,
      status: transaction.status,
      policies: transaction.policyResults,
    },
  };
}

registerPolicy("supplier.bill.approve", "1", ({ input }) => (
  input?.billId
    ? { allowed: true, code: "supplier_bill.approve.valid" }
    : { allowed: false, statusCode: 400, code: "supplier_bill.required", reason: "Une facture fournisseur est requise." }
));

registerPolicy("supplier.bill.credit_note.post", "1", ({ input, idempotencyKey }) => {
  if (!input?.billId) return { allowed: false, statusCode: 400, code: "supplier_credit.bill_required", reason: "Une facture fournisseur est requise." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "supplier_credit.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  if (!String(input.reason || "").trim()) return { allowed: false, statusCode: 400, code: "supplier_credit.reason_required", reason: "La raison de la note de crédit est obligatoire." };
  if (normalizeMoney(input.total) === null) return { allowed: false, statusCode: 400, code: "supplier_credit.amount_invalid", reason: "Le montant de la note de crédit doit être supérieur à zéro." };
  return { allowed: true, code: "supplier_credit.valid" };
});

registerPolicy("supplier.bill.void", "1", ({ input, idempotencyKey }) => {
  if (!input?.billId) return { allowed: false, statusCode: 400, code: "supplier_void.bill_required", reason: "Une facture fournisseur est requise." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "supplier_void.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  if (!String(input.reason || "").trim()) return { allowed: false, statusCode: 400, code: "supplier_void.reason_required", reason: "La raison de l’annulation est obligatoire." };
  return { allowed: true, code: "supplier_void.valid" };
});

async function loadBillForUpdate(client, organisationId, billId) {
  const billResult = await client.query(
    `SELECT * FROM supplier_bills
     WHERE organisation_id = $1 AND id = $2
     FOR UPDATE`,
    [organisationId, billId],
  );
  const bill = billResult.rows[0];
  if (!bill) return null;

  const totals = await client.query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM supplier_payments
                 WHERE organisation_id = $1 AND supplier_bill_id = $2 AND reversed_at IS NULL), 0)::numeric(14,2) AS paid_total,
       COALESCE((SELECT SUM(total) FROM supplier_credit_notes
                 WHERE organisation_id = $1 AND supplier_bill_id = $2), 0)::numeric(14,2) AS credited_total`,
    [organisationId, billId],
  );
  return { ...bill, ...totals.rows[0] };
}

async function createEvidence(client, {
  organisationId,
  transactionId,
  correlationId,
  aggregateType,
  aggregateId,
  event,
  accountingEntryId,
  checks,
  relation = "accounted_as",
}) {
  const trust = await persistTrustAssessment(client, {
    organisationId,
    transactionId,
    correlationId,
    checks,
  });
  const graph = await persistGraphEdges(client, {
    organisationId,
    transactionId,
    correlationId,
    edges: [
      { from: { type: aggregateType, id: aggregateId }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } },
      ...(accountingEntryId ? [{ from: { type: aggregateType, id: aggregateId }, relation, to: { type: "accounting_entry", id: accountingEntryId }, provenance: { eventId: event.event_id } }] : []),
      { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: aggregateType, id: aggregateId }, provenance: { transactionId } },
    ],
  });
  return { trust, graph };
}

async function approveSupplierBill({ billId, organisationId, createdBy }) {
  const transaction = await executeTransaction({
    type: "supplier.bill.approve",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    policies: [APPROVE_POLICY],
    input: { billId },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId, input }) => {
      const bill = await loadBillForUpdate(client, orgId, input.billId);
      if (!bill) return null;
      if (["approved", "partially_paid", "paid"].includes(bill.status) && bill.accounting_entry_id) {
        return { duplicate: true, bill, accountingEntryId: bill.accounting_entry_id };
      }
      if (bill.status !== "draft") throw Object.assign(new Error("Seule une facture fournisseur en brouillon peut être approuvée."), { statusCode: 409 });

      const accounting = await recordSupplierBillAccounting({ client, organisationId: orgId, bill, createdBy: actorUserId });
      const updated = await client.query(
        `UPDATE supplier_bills SET status = 'approved', accounting_entry_id = $1
         WHERE organisation_id = $2 AND id = $3 AND status = 'draft'
         RETURNING *`,
        [accounting.entryId || null, orgId, bill.id],
      );
      if (!updated.rows[0]) throw Object.assign(new Error("La facture fournisseur a été modifiée en parallèle."), { statusCode: 409 });

      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "supplier.bill.approved",
        aggregateType: "supplier_bill",
        aggregateId: bill.id,
        actorUserId,
        correlationId,
        occurredAt: bill.bill_date,
        metadata: { transactionId, policyVersions: [APPROVE_POLICY] },
        payload: { billId: bill.id, supplierId: bill.supplier_id, billNumber: bill.bill_number, total: Number(bill.total), accountingEntryId: accounting.entryId || null },
      });
      const evidence = await createEvidence(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        aggregateType: "supplier_bill",
        aggregateId: bill.id,
        event,
        accountingEntryId: accounting.entryId,
        checks: [
          { code: "supplier_bill.approved", passed: updated.rows[0].status === "approved", evidence: [{ status: updated.rows[0].status }] },
          { code: "supplier_bill.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id || null }] },
          { code: "supplier_bill.accounting_recorded", passed: Boolean(accounting.entryId), severity: accounting.entryId ? "info" : "warning", evidence: [{ accountingEntryId: accounting.entryId || null, reason: accounting.reason || null }] },
        ],
      });
      return { duplicate: false, bill: updated.rows[0], accounting, event, ...evidence };
    },
    verify: async ({ result }) => {
      if (!result || result.duplicate) return;
      if (!result.event?.event_id || !result.trust?.assessmentId) throw new Error("Validation postérieure de l’approbation fournisseur incomplète.");
    },
  });
  return ctResult(transaction);
}

async function postSupplierCreditNote({ billId, organisationId, subtotal, taxTotal = 0, total, reason, idempotencyKey, creditedAt, createdBy }) {
  const transaction = await executeTransaction({
    type: "supplier.bill.credit_note.post",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [CREDIT_POLICY],
    input: { billId, subtotal, taxTotal, total, reason, creditedAt },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId, idempotencyKey: key, input }) => {
      const normalizedKey = String(key).trim();
      const existing = await client.query(
        `SELECT * FROM supplier_credit_notes WHERE organisation_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [orgId, normalizedKey],
      );
      if (existing.rows[0]) return { duplicate: true, creditNote: existing.rows[0] };

      const bill = await loadBillForUpdate(client, orgId, input.billId);
      if (!bill) return null;
      if (!["approved", "partially_paid", "paid"].includes(bill.status)) throw Object.assign(new Error("La facture fournisseur doit être approuvée avant l’émission d’un crédit."), { statusCode: 409 });

      const normalizedSubtotal = normalizeMoney(input.subtotal, { allowZero: true });
      const normalizedTax = normalizeMoney(input.taxTotal, { allowZero: true });
      const normalizedTotal = normalizeMoney(input.total);
      if (normalizedSubtotal === null || normalizedTax === null || normalizedTotal === null || Number((normalizedSubtotal + normalizedTax).toFixed(2)) !== normalizedTotal) {
        throw Object.assign(new Error("Les montants de la note de crédit sont incohérents."), { statusCode: 400 });
      }
      const available = Number((Number(bill.total) - Number(bill.credited_total)).toFixed(2));
      if (normalizedTotal > available) throw Object.assign(new Error("La note de crédit dépasse le montant encore créditable."), { statusCode: 409, details: { available } });

      await client.query("SELECT pg_advisory_xact_lock(482021, COALESCE($1::int, 0))", [orgId]);
      const sequence = await client.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(credit_number FROM '([0-9]+)$') AS integer)), 0) + 1 AS next_seq
         FROM supplier_credit_notes WHERE organisation_id = $1`,
        [orgId],
      );
      const creditNumber = `NCF-${String(sequence.rows[0].next_seq).padStart(5, "0")}`;
      const inserted = await client.query(
        `INSERT INTO supplier_credit_notes
          (organisation_id, supplier_bill_id, supplier_id, credit_number, subtotal, tax_total, total, reason, idempotency_key, credited_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,NOW()),$11)
         RETURNING *`,
        [orgId, bill.id, bill.supplier_id, creditNumber, normalizedSubtotal, normalizedTax, normalizedTotal, String(input.reason).trim(), normalizedKey, input.creditedAt || null, actorUserId || null],
      );
      const creditNote = inserted.rows[0];

      const codes = [ACCOUNT_CODES.payables, ACCOUNT_CODES.generalExpense];
      if (normalizedTax > 0) codes.push(ACCOUNT_CODES.taxReceivable);
      const accounts = await loadAccounts(client, orgId, codes);
      let accounting = { skipped: true, reason: "chart_of_accounts_not_initialized" };
      if (codes.every((code) => accounts.has(code))) {
        accounting = await recordPostedEntry(client, {
          organisationId: orgId,
          userId: actorUserId,
          journalCode: "ACH",
          journalName: "Journal des achats",
          journalType: "purchases",
          entryNumber: `ACH-NCF-${creditNote.id}`,
          entryDate: String(input.creditedAt || new Date().toISOString()).slice(0, 10),
          description: `Note de crédit fournisseur ${creditNumber}`,
          sourceType: "supplier_credit_note",
          sourceId: creditNote.id,
          lines: [
            { accountId: accounts.get(ACCOUNT_CODES.payables), description: "Réduction du compte fournisseur", debit: normalizedTotal, credit: 0 },
            { accountId: accounts.get(ACCOUNT_CODES.generalExpense), description: "Réduction des achats", debit: 0, credit: normalizedSubtotal },
            { accountId: accounts.get(ACCOUNT_CODES.taxReceivable), description: "Réduction des taxes à recevoir", debit: 0, credit: normalizedTax },
          ],
        });
        await client.query(
          `UPDATE supplier_credit_notes SET accounting_entry_id = $1 WHERE organisation_id = $2 AND id = $3`,
          [accounting.entryId, orgId, creditNote.id],
        );
        creditNote.accounting_entry_id = accounting.entryId;
      }

      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "supplier.bill.credit_note.posted",
        aggregateType: "supplier_bill",
        aggregateId: bill.id,
        actorUserId,
        correlationId,
        occurredAt: creditNote.credited_at,
        metadata: { transactionId, policyVersions: [CREDIT_POLICY], idempotencyKey: normalizedKey },
        payload: { billId: bill.id, creditNoteId: creditNote.id, creditNumber, total: normalizedTotal, accountingEntryId: accounting.entryId || null },
      });
      const evidence = await createEvidence(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        aggregateType: "supplier_credit_note",
        aggregateId: creditNote.id,
        event,
        accountingEntryId: accounting.entryId,
        checks: [
          { code: "supplier_credit.persisted", passed: Boolean(creditNote.id), evidence: [{ creditNoteId: creditNote.id }] },
          { code: "supplier_credit.within_available", passed: normalizedTotal <= available, evidence: [{ total: normalizedTotal, available }] },
          { code: "supplier_credit.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id || null }] },
        ],
      });
      await persistGraphEdges(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        edges: [{ from: { type: "supplier_bill", id: bill.id }, relation: "credited_by", to: { type: "supplier_credit_note", id: creditNote.id }, provenance: { eventId: event.event_id } }],
      });
      return { duplicate: false, creditNote, accounting, event, ...evidence };
    },
    verify: async ({ result }) => {
      if (!result || result.duplicate) return;
      if (!result.creditNote?.id || !result.event?.event_id || !result.trust?.assessmentId) throw new Error("Validation postérieure de la note de crédit fournisseur incomplète.");
    },
  });
  return ctResult(transaction);
}

async function voidSupplierBill({ billId, organisationId, reason, idempotencyKey, voidedAt, createdBy }) {
  const transaction = await executeTransaction({
    type: "supplier.bill.void",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [VOID_POLICY],
    input: { billId, reason, voidedAt },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId, idempotencyKey: key, input }) => {
      const normalizedKey = String(key).trim();
      const bill = await loadBillForUpdate(client, orgId, input.billId);
      if (!bill) return null;
      if (bill.status === "void") {
        if (bill.void_idempotency_key === normalizedKey) return { duplicate: true, bill };
        throw Object.assign(new Error("Cette facture fournisseur est déjà annulée."), { statusCode: 409 });
      }
      if (!["approved", "partially_paid", "paid"].includes(bill.status)) throw Object.assign(new Error("Seule une facture fournisseur approuvée peut être annulée."), { statusCode: 409 });
      if (Number(bill.paid_total) > 0) throw Object.assign(new Error("Les paiements actifs doivent être renversés avant l’annulation."), { statusCode: 409 });
      if (Number(bill.credited_total) > 0) throw Object.assign(new Error("Une facture ayant des notes de crédit ne peut pas être annulée; utilisez une opération compensatoire."), { statusCode: 409 });

      let accounting = { skipped: true, reason: "original_entry_missing" };
      if (bill.accounting_entry_id) {
        const original = await client.query(
          `SELECT account_id, debit, credit, description
           FROM accounting_entry_lines
           WHERE organisation_id = $1 AND entry_id = $2
           ORDER BY id`,
          [orgId, bill.accounting_entry_id],
        );
        if (original.rows.length) {
          accounting = await recordPostedEntry(client, {
            organisationId: orgId,
            userId: actorUserId,
            journalCode: "ACH",
            journalName: "Journal des achats",
            journalType: "purchases",
            entryNumber: `ACH-ANN-${bill.id}`,
            entryDate: String(input.voidedAt || new Date().toISOString()).slice(0, 10),
            description: `Annulation facture fournisseur ${bill.bill_number}`,
            sourceType: "supplier_bill_void",
            sourceId: bill.id,
            lines: original.rows.map((line) => ({
              accountId: line.account_id,
              description: `Renversement: ${line.description || ""}`,
              debit: Number(line.credit),
              credit: Number(line.debit),
            })),
          });
        }
      }

      const updated = await client.query(
        `UPDATE supplier_bills
         SET status = 'void', voided_at = COALESCE($1::timestamptz,NOW()), voided_by = $2,
             void_reason = $3, void_idempotency_key = $4
         WHERE organisation_id = $5 AND id = $6
         RETURNING *`,
        [input.voidedAt || null, actorUserId || null, String(input.reason).trim(), normalizedKey, orgId, bill.id],
      );
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "supplier.bill.voided",
        aggregateType: "supplier_bill",
        aggregateId: bill.id,
        actorUserId,
        correlationId,
        occurredAt: updated.rows[0].voided_at,
        metadata: { transactionId, policyVersions: [VOID_POLICY], idempotencyKey: normalizedKey },
        payload: { billId: bill.id, billNumber: bill.bill_number, reason: String(input.reason).trim(), reversalAccountingEntryId: accounting.entryId || null },
      });
      const evidence = await createEvidence(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        aggregateType: "supplier_bill",
        aggregateId: bill.id,
        event,
        accountingEntryId: accounting.entryId,
        relation: "reversed_by",
        checks: [
          { code: "supplier_bill.voided", passed: updated.rows[0].status === "void", evidence: [{ status: updated.rows[0].status }] },
          { code: "supplier_bill.no_active_payments", passed: Number(bill.paid_total) === 0, evidence: [{ paidTotal: bill.paid_total }] },
          { code: "supplier_bill.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id || null }] },
        ],
      });
      return { duplicate: false, bill: updated.rows[0], accounting, event, ...evidence };
    },
    verify: async ({ result }) => {
      if (!result || result.duplicate) return;
      if (result.bill?.status !== "void" || !result.event?.event_id || !result.trust?.assessmentId) throw new Error("Validation postérieure de l’annulation fournisseur incomplète.");
    },
  });
  return ctResult(transaction);
}

module.exports = {
  APPROVE_POLICY,
  CREDIT_POLICY,
  VOID_POLICY,
  validIdempotency,
  normalizeMoney,
  approveSupplierBill,
  postSupplierCreditNote,
  voidSupplierBill,
};
