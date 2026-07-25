const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");
const { ACCOUNT_CODES, loadAccounts, recordPostedEntry, money } = require("./accounting-sync.service");

const CUSTOMER_PAYMENT_REVERSAL_POLICY = "invoice.payment.reverse@1";
const INVOICE_VOID_POLICY = "invoice.void@1";
const CREDIT_NOTE_POLICY = "invoice.credit_note.post@1";

function requireIntent(input, idempotencyKey, { reason = true } = {}) {
  if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
    return { allowed: false, statusCode: 400, code: "reversal.idempotency_key_required", reason: "Une clé d’idempotence valide est obligatoire." };
  }
  if (reason && (!input?.reason || String(input.reason).trim().length < 3)) {
    return { allowed: false, statusCode: 400, code: "reversal.reason_required", reason: "Une raison explicite est obligatoire." };
  }
  return { allowed: true, code: "reversal.intent_valid" };
}

function evaluateCustomerPaymentReversalPolicy({ input, idempotencyKey }) {
  const base = requireIntent(input, idempotencyKey);
  if (!base.allowed) return base;
  if (!input?.paymentId) return { allowed: false, statusCode: 400, code: "payment_reversal.payment_required", reason: "Un paiement client est requis." };
  return { allowed: true, code: "payment_reversal.input_valid" };
}

function evaluateInvoiceVoidPolicy({ input, idempotencyKey }) {
  const base = requireIntent(input, idempotencyKey);
  if (!base.allowed) return base;
  if (!input?.invoiceId) return { allowed: false, statusCode: 400, code: "invoice_void.invoice_required", reason: "Une facture est requise." };
  return { allowed: true, code: "invoice_void.input_valid" };
}

function evaluateCreditNotePolicy({ input, idempotencyKey }) {
  const base = requireIntent(input, idempotencyKey);
  if (!base.allowed) return base;
  if (!input?.invoiceId) return { allowed: false, statusCode: 400, code: "credit_note.invoice_required", reason: "Une facture est requise." };
  const subtotal = Number(input.subtotal);
  const taxTotal = Number(input.taxTotal || 0);
  if (!Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(taxTotal) || taxTotal < 0) {
    return { allowed: false, statusCode: 400, code: "credit_note.amount_invalid", reason: "Les montants de la note de crédit sont invalides." };
  }
  return { allowed: true, code: "credit_note.input_valid" };
}

registerPolicy("invoice.payment.reverse", "1", evaluateCustomerPaymentReversalPolicy);
registerPolicy("invoice.void", "1", evaluateInvoiceVoidPolicy);
registerPolicy("invoice.credit_note.post", "1", evaluateCreditNotePolicy);

async function reverseAccountingEntry(client, { organisationId, originalEntryId, sourceType, sourceId, description, entryDate, createdBy }) {
  if (!originalEntryId) return { skipped: true, reason: "original_accounting_entry_absent" };
  const original = await client.query(
    `SELECT e.*, j.code journal_code, j.name journal_name, j.journal_type
     FROM accounting_entries e JOIN accounting_journals j ON j.id=e.journal_id
     WHERE e.id=$1 AND e.organisation_id=$2 AND e.status='posted' FOR UPDATE`,
    [originalEntryId, organisationId],
  );
  if (!original.rows[0]) return { skipped: true, reason: "original_accounting_entry_not_posted" };
  const lines = await client.query(
    `SELECT account_id, description, debit, credit FROM accounting_entry_lines
     WHERE organisation_id=$1 AND entry_id=$2 ORDER BY id`,
    [organisationId, originalEntryId],
  );
  const reversal = await recordPostedEntry(client, {
    organisationId,
    userId: createdBy,
    journalCode: original.rows[0].journal_code,
    journalName: original.rows[0].journal_name,
    journalType: original.rows[0].journal_type,
    entryNumber: `REV-${sourceType}-${sourceId}`,
    entryDate: new Date(entryDate || Date.now()).toISOString().slice(0, 10),
    description,
    sourceType,
    sourceId,
    lines: lines.rows.map((line) => ({ accountId: line.account_id, description: line.description, debit: Number(line.credit), credit: Number(line.debit) })),
  });
  await client.query("UPDATE accounting_entries SET status='reversed' WHERE id=$1 AND organisation_id=$2", [originalEntryId, organisationId]);
  return reversal;
}

async function persistEvidence(client, { organisationId, transactionId, correlationId, checks, edges }) {
  const trust = await persistTrustAssessment(client, { organisationId, transactionId, correlationId, checks });
  const graph = await persistGraphEdges(client, { organisationId, transactionId, correlationId, edges });
  return { trust, graph };
}

async function executeCustomerPaymentReversal(context) {
  const { client, transactionId, correlationId, organisationId, actorUserId, idempotencyKey, input } = context;
  const paymentResult = await client.query(
    `SELECT p.*, i.status invoice_status, i.invoice_number
     FROM invoice_payments p JOIN invoices i ON i.id=p.invoice_id AND i.organisation_id=p.organisation_id
     WHERE p.id=$1 AND p.organisation_id=$2 FOR UPDATE OF p, i`,
    [input.paymentId, organisationId],
  );
  const payment = paymentResult.rows[0];
  if (!payment) return null;
  if (payment.reversed_at) return { duplicate: true, payment };

  const accounting = await reverseAccountingEntry(client, {
    organisationId,
    originalEntryId: payment.accounting_entry_id,
    sourceType: "invoice_payment_reversal",
    sourceId: payment.id,
    description: `Renversement du paiement client ${payment.id}`,
    entryDate: input.reversedAt,
    createdBy: actorUserId,
  });

  const updated = await client.query(
    `UPDATE invoice_payments SET reversed_at=COALESCE($1::timestamptz,NOW()), reversal_reason=$2,
       reversed_by=$3, reversal_idempotency_key=$4, reversal_accounting_entry_id=$5
     WHERE id=$6 AND organisation_id=$7 AND reversed_at IS NULL RETURNING *`,
    [input.reversedAt || null, String(input.reason).trim(), actorUserId || null, idempotencyKey, accounting.entryId || null, payment.id, organisationId],
  );

  await client.query(
    `UPDATE invoices SET status='sent', version=version+1
     WHERE id=$1 AND organisation_id=$2 AND status='paid'`,
    [payment.invoice_id, organisationId],
  );

  const event = await appendEvent(client, {
    organisationId,
    eventType: "payment.reversed",
    aggregateType: "invoice",
    aggregateId: payment.invoice_id,
    actorUserId,
    correlationId,
    occurredAt: input.reversedAt || new Date(),
    metadata: { transactionId, policyVersions: [CUSTOMER_PAYMENT_REVERSAL_POLICY] },
    payload: { paymentId: payment.id, invoiceId: payment.invoice_id, amount: Number(payment.amount), reason: input.reason, reversalAccountingEntryId: accounting.entryId || null },
  });

  const evidence = await persistEvidence(client, {
    organisationId, transactionId, correlationId,
    checks: [
      { code: "customer_payment.reversed", passed: Boolean(updated.rows[0]?.reversed_at), evidence: [{ paymentId: payment.id }] },
      { code: "customer_payment.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id }] },
      { code: "customer_payment.accounting_reversed", passed: accounting.skipped ? true : Boolean(accounting.entryId), severity: accounting.skipped ? "warning" : "info", explanation: accounting.skipped ? accounting.reason : null },
    ],
    edges: [
      { from: { type: "invoice_payment", id: payment.id }, relation: "reversed_by", to: { type: "business_event", id: event.event_id }, provenance: { transactionId } },
      ...(accounting.entryId ? [{ from: { type: "invoice_payment", id: payment.id }, relation: "reversed_by_accounting_entry", to: { type: "accounting_entry", id: accounting.entryId }, provenance: { transactionId } }] : []),
    ],
  });
  return { duplicate: false, payment: updated.rows[0], accounting, event, ...evidence };
}

async function executeInvoiceVoid(context) {
  const { client, transactionId, correlationId, organisationId, actorUserId, idempotencyKey, input } = context;
  const invoiceResult = await client.query(
    `SELECT * FROM invoices WHERE id=$1 AND organisation_id=$2 AND deleted_at IS NULL FOR UPDATE`,
    [input.invoiceId, organisationId],
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) return null;
  if (invoice.status === "void") return { duplicate: true, invoice };
  if (!invoice.finalized_at || !["finalized", "sent"].includes(invoice.status)) {
    throw Object.assign(new Error("Seule une facture finalisée non payée peut être annulée."), { statusCode: 409 });
  }
  const activePayments = await client.query(
    `SELECT COUNT(*)::int count FROM invoice_payments WHERE organisation_id=$1 AND invoice_id=$2 AND reversed_at IS NULL`,
    [organisationId, invoice.id],
  );
  if (activePayments.rows[0].count > 0) {
    throw Object.assign(new Error("Les paiements actifs doivent être renversés avant l’annulation de la facture."), { statusCode: 409 });
  }
  const source = await client.query(
    `SELECT id FROM accounting_entries WHERE organisation_id=$1 AND source_type='invoice' AND source_id=$2 AND status='posted' LIMIT 1`,
    [organisationId, String(invoice.id)],
  );
  const accounting = await reverseAccountingEntry(client, {
    organisationId, originalEntryId: source.rows[0]?.id, sourceType: "invoice_void", sourceId: invoice.id,
    description: `Annulation de la facture ${invoice.invoice_number || invoice.id}`, entryDate: input.voidedAt, createdBy: actorUserId,
  });
  const updated = await client.query(
    `UPDATE invoices SET status='void', voided_at=COALESCE($1::timestamptz,NOW()), void_reason=$2,
       voided_by=$3, void_idempotency_key=$4, void_accounting_entry_id=$5, version=version+1
     WHERE id=$6 AND organisation_id=$7 RETURNING *`,
    [input.voidedAt || null, String(input.reason).trim(), actorUserId || null, idempotencyKey, accounting.entryId || null, invoice.id, organisationId],
  );
  const event = await appendEvent(client, {
    organisationId, eventType: "invoice.voided", aggregateType: "invoice", aggregateId: invoice.id,
    actorUserId, correlationId, occurredAt: input.voidedAt || new Date(),
    metadata: { transactionId, policyVersions: [INVOICE_VOID_POLICY] },
    payload: { invoiceId: invoice.id, reason: input.reason, reversalAccountingEntryId: accounting.entryId || null },
  });
  const evidence = await persistEvidence(client, {
    organisationId, transactionId, correlationId,
    checks: [
      { code: "invoice.voided", passed: updated.rows[0]?.status === "void", evidence: [{ invoiceId: invoice.id }] },
      { code: "invoice.void_event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id }] },
      { code: "invoice.accounting_reversed", passed: accounting.skipped ? true : Boolean(accounting.entryId), severity: accounting.skipped ? "warning" : "info", explanation: accounting.skipped ? accounting.reason : null },
    ],
    edges: [
      { from: { type: "invoice", id: invoice.id }, relation: "voided_by", to: { type: "business_event", id: event.event_id }, provenance: { transactionId } },
      ...(accounting.entryId ? [{ from: { type: "invoice", id: invoice.id }, relation: "reversed_by_accounting_entry", to: { type: "accounting_entry", id: accounting.entryId }, provenance: { transactionId } }] : []),
    ],
  });
  return { duplicate: false, invoice: updated.rows[0], accounting, event, ...evidence };
}

async function executeCreditNote(context) {
  const { client, transactionId, correlationId, organisationId, actorUserId, idempotencyKey, input } = context;
  const duplicate = await client.query("SELECT * FROM invoice_credit_notes WHERE organisation_id=$1 AND idempotency_key=$2", [organisationId, idempotencyKey]);
  if (duplicate.rows[0]) return { duplicate: true, creditNote: duplicate.rows[0] };
  const invoiceResult = await client.query(
    `SELECT i.*, COALESCE((SELECT SUM(c.total) FROM invoice_credit_notes c WHERE c.organisation_id=i.organisation_id AND c.invoice_id=i.id AND c.status='posted'),0) credited_total
     FROM invoices i WHERE i.id=$1 AND i.organisation_id=$2 AND i.deleted_at IS NULL FOR UPDATE`,
    [input.invoiceId, organisationId],
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice || !invoice.finalized_at || invoice.status === "void") return null;
  const subtotal = money(input.subtotal);
  const taxTotal = money(input.taxTotal || 0, { allowZero: true });
  const total = money(subtotal + taxTotal);
  const remainingCredit = Number((Number(invoice.total) - Number(invoice.credited_total)).toFixed(2));
  if (total > remainingCredit) throw Object.assign(new Error("La note de crédit dépasse le montant encore créditable."), { statusCode: 409 });

  const accounts = await loadAccounts(client, organisationId, [ACCOUNT_CODES.receivables, ACCOUNT_CODES.serviceRevenue, ACCOUNT_CODES.taxPayable]);
  let accounting = { skipped: true, reason: "chart_of_accounts_not_initialized" };
  if (accounts.has(ACCOUNT_CODES.receivables) && accounts.has(ACCOUNT_CODES.serviceRevenue) && (taxTotal === 0 || accounts.has(ACCOUNT_CODES.taxPayable))) {
    accounting = await recordPostedEntry(client, {
      organisationId, userId: actorUserId, journalCode: "VEN", journalName: "Journal des ventes", journalType: "sales",
      entryNumber: `NC-${invoice.id}-${Date.now()}`, entryDate: new Date(input.issuedAt || Date.now()).toISOString().slice(0, 10),
      description: `Note de crédit — facture ${invoice.invoice_number || invoice.id}`, sourceType: "invoice_credit_note", sourceId: `${invoice.id}:${idempotencyKey}`,
      lines: [
        { accountId: accounts.get(ACCOUNT_CODES.serviceRevenue), description: "Réduction des revenus", debit: subtotal, credit: 0 },
        ...(taxTotal > 0 ? [{ accountId: accounts.get(ACCOUNT_CODES.taxPayable), description: "Réduction des taxes à remettre", debit: taxTotal, credit: 0 }] : []),
        { accountId: accounts.get(ACCOUNT_CODES.receivables), description: "Réduction du compte client", debit: 0, credit: total },
      ],
    });
  }
  const numberResult = await client.query("SELECT COALESCE(MAX(id),0)+1 next FROM invoice_credit_notes WHERE organisation_id=$1", [organisationId]);
  const creditNumber = `NC-${String(numberResult.rows[0].next).padStart(5, "0")}`;
  const inserted = await client.query(
    `INSERT INTO invoice_credit_notes
      (organisation_id,invoice_id,credit_number,subtotal,tax_total,total,reason,idempotency_key,accounting_entry_id,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [organisationId, invoice.id, creditNumber, subtotal, taxTotal, total, String(input.reason).trim(), idempotencyKey, accounting.entryId || null, actorUserId || null],
  );
  const creditNote = inserted.rows[0];
  const event = await appendEvent(client, {
    organisationId, eventType: "invoice.credit_note.posted", aggregateType: "invoice", aggregateId: invoice.id,
    actorUserId, correlationId, occurredAt: input.issuedAt || new Date(),
    metadata: { transactionId, policyVersions: [CREDIT_NOTE_POLICY] },
    payload: { creditNoteId: creditNote.id, invoiceId: invoice.id, subtotal, taxTotal, total, accountingEntryId: accounting.entryId || null },
  });
  const evidence = await persistEvidence(client, {
    organisationId, transactionId, correlationId,
    checks: [
      { code: "credit_note.persisted", passed: Boolean(creditNote.id), evidence: [{ creditNoteId: creditNote.id }] },
      { code: "credit_note.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id }] },
      { code: "credit_note.accounting_posted", passed: accounting.skipped ? true : Boolean(accounting.entryId), severity: accounting.skipped ? "warning" : "info", explanation: accounting.skipped ? accounting.reason : null },
    ],
    edges: [
      { from: { type: "invoice", id: invoice.id }, relation: "credited_by", to: { type: "invoice_credit_note", id: creditNote.id }, provenance: { transactionId } },
      { from: { type: "invoice_credit_note", id: creditNote.id }, relation: "produced", to: { type: "business_event", id: event.event_id }, provenance: { transactionId } },
      ...(accounting.entryId ? [{ from: { type: "invoice_credit_note", id: creditNote.id }, relation: "accounted_as", to: { type: "accounting_entry", id: accounting.entryId }, provenance: { transactionId } }] : []),
    ],
  });
  return { duplicate: false, creditNote, accounting, event, ...evidence };
}

function verifyResult(kind) {
  return async ({ result }) => {
    if (!result || result.duplicate) return;
    if (!result.event?.event_id) throw Object.assign(new Error(`L’événement ${kind} est absent.`), { statusCode: 500 });
    if (!result.trust?.assessmentId) throw Object.assign(new Error(`Le constat MADTrust ${kind} est absent.`), { statusCode: 500 });
    if (!Array.isArray(result.graph) || result.graph.length < 1) throw Object.assign(new Error(`Le graphe ${kind} est incomplet.`), { statusCode: 500 });
  };
}

async function run(type, policy, input, organisationId, actorUserId, idempotencyKey, execute, verify) {
  const transaction = await executeTransaction({ type, organisationId: organisationValue(organisationId), actorUserId, idempotencyKey, policies: [policy], input, execute, verify });
  if (!transaction.result) return null;
  return { ...transaction.result, ct_mad: { transactionId: transaction.transactionId, correlationId: transaction.correlationId, status: transaction.status, policies: transaction.policyResults } };
}

const reverseCustomerPayment = (args) => run("invoice.payment.reverse", CUSTOMER_PAYMENT_REVERSAL_POLICY, args, args.organisationId, args.createdBy, args.idempotencyKey, executeCustomerPaymentReversal, verifyResult("du renversement du paiement client"));
const voidInvoice = (args) => run("invoice.void", INVOICE_VOID_POLICY, args, args.organisationId, args.createdBy, args.idempotencyKey, executeInvoiceVoid, verifyResult("de l’annulation de facture"));
const postCreditNote = (args) => run("invoice.credit_note.post", CREDIT_NOTE_POLICY, args, args.organisationId, args.createdBy, args.idempotencyKey, executeCreditNote, verifyResult("de la note de crédit"));

module.exports = {
  CUSTOMER_PAYMENT_REVERSAL_POLICY, INVOICE_VOID_POLICY, CREDIT_NOTE_POLICY,
  evaluateCustomerPaymentReversalPolicy, evaluateInvoiceVoidPolicy, evaluateCreditNotePolicy,
  reverseCustomerPayment, voidInvoice, postCreditNote,
};
