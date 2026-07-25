const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { recordLedgerEntry } = require("./invoice-ledger.service");
const { recordInvoicePaymentAccounting } = require("../business/accounting-sync.service");
const { appendEvent } = require("../business/business-event.service");
const { executeTransaction, registerPolicy } = require("../business/transaction-engine.service");
const { persistTrustAssessment, persistGraphEdges } = require("../business/trust-persistence.service");

const PAYMENT_METHODS = ["cash", "cheque", "bank_transfer", "card", "stripe", "other"];
const INVOICE_PAYMENT_POLICY = "invoice.payment.receive@1";

function cents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.round((number + Number.EPSILON) * 100);
}

function moneyFromCents(value) {
  return (Number(value || 0) / 100).toFixed(2);
}

function evaluateInvoicePaymentPolicy({ input, idempotencyKey }) {
  const amountCents = cents(input?.amount);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { allowed: false, statusCode: 400, code: "invoice_payment.amount_invalid", reason: "Le montant du paiement doit être supérieur à zéro." };
  }
  if (!PAYMENT_METHODS.includes(input?.method)) {
    return { allowed: false, statusCode: 400, code: "invoice_payment.method_invalid", reason: "Méthode de paiement invalide." };
  }
  if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
    return { allowed: false, statusCode: 400, code: "invoice_payment.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  }
  if (input?.invoiceId === undefined || input?.invoiceId === null || input?.invoiceId === "") {
    return { allowed: false, statusCode: 400, code: "invoice_payment.invoice_required", reason: "Une facture est requise." };
  }
  return { allowed: true, code: "invoice_payment.input_valid" };
}

registerPolicy("invoice.payment.receive", "1", evaluateInvoicePaymentPolicy);

async function lockInvoice({ invoiceId, organisationId, client }) {
  const result = await client.query(
    `SELECT id FROM invoices
     WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [invoiceId, organisationValue(organisationId)],
  );
  return Boolean(result.rows[0]);
}

async function loadInvoiceBalance({ invoiceId, organisationId, client = db, lock = false }) {
  if (lock) {
    const found = await lockInvoice({ invoiceId, organisationId, client });
    if (!found) return null;
  }
  const result = await client.query(
    `SELECT i.id, i.invoice_number, i.status, i.total, i.finalized_at,
            COALESCE(SUM(p.amount), 0)::numeric(14,2) AS paid_total
     FROM invoices i
     LEFT JOIN invoice_payments p ON p.invoice_id = i.id AND p.organisation_id = i.organisation_id
     WHERE i.id = $1 AND i.organisation_id = $2 AND i.deleted_at IS NULL
     GROUP BY i.id`,
    [invoiceId, organisationValue(organisationId)],
  );
  const invoice = result.rows[0];
  if (!invoice) return null;
  const totalCents = cents(invoice.total);
  const paidCents = cents(invoice.paid_total);
  const balanceCents = Math.max(0, totalCents - paidCents);
  return {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    finalized_at: invoice.finalized_at,
    currency: "CAD",
    total: moneyFromCents(totalCents),
    paid_total: moneyFromCents(paidCents),
    balance: moneyFromCents(balanceCents),
    is_paid: balanceCents === 0,
  };
}

async function listInvoicePayments({ invoiceId, organisationId }) {
  const summary = await loadInvoiceBalance({ invoiceId, organisationId });
  if (!summary) return null;
  const result = await db.query(
    `SELECT id, invoice_id, amount, currency, method, source,
            external_reference, note, received_at, created_at
     FROM invoice_payments
     WHERE organisation_id = $1 AND invoice_id = $2
     ORDER BY received_at DESC, id DESC`,
    [organisationValue(organisationId), invoiceId],
  );
  return { summary, payments: result.rows };
}

async function executeInvoicePayment({ client, transactionId, correlationId, organisationId, actorUserId, idempotencyKey, input }) {
  const amountCents = cents(input.amount);
  const normalizedIdempotencyKey = String(idempotencyKey).trim();
  const existing = await client.query(
    `SELECT id, invoice_id, amount, currency, method, source,
            external_reference, note, received_at, created_at
     FROM invoice_payments
     WHERE organisation_id = $1 AND idempotency_key = $2
     FOR UPDATE`,
    [organisationId, normalizedIdempotencyKey],
  );
  if (existing.rows[0]) {
    if (Number(existing.rows[0].invoice_id) !== Number(input.invoiceId) || cents(existing.rows[0].amount) !== amountCents) {
      throw Object.assign(new Error("Cette clé d’idempotence est déjà utilisée pour un autre paiement."), { statusCode: 409 });
    }
    const summary = await loadInvoiceBalance({ invoiceId: input.invoiceId, organisationId, client, lock: true });
    return { duplicate: true, payment: existing.rows[0], summary };
  }

  const summaryBefore = await loadInvoiceBalance({ invoiceId: input.invoiceId, organisationId, client, lock: true });
  if (!summaryBefore) return null;
  if (!summaryBefore.finalized_at || !["sent", "paid"].includes(summaryBefore.status)) {
    throw Object.assign(new Error("Seule une facture finalisée et envoyée peut recevoir un paiement."), { statusCode: 409 });
  }
  const balanceCents = cents(summaryBefore.balance);
  if (balanceCents === 0) throw Object.assign(new Error("Cette facture est déjà entièrement payée."), { statusCode: 409 });
  if (amountCents > balanceCents) {
    throw Object.assign(new Error("Le paiement dépasse le solde restant."), { statusCode: 409, details: { balance: summaryBefore.balance } });
  }

  const inserted = await client.query(
    `INSERT INTO invoice_payments
      (organisation_id, invoice_id, amount, currency, method, source,
       external_reference, note, idempotency_key, received_at, created_by)
     VALUES ($1,$2,$3,'CAD',$4,$5,$6,$7,$8,COALESCE($9::timestamptz,NOW()),$10)
     RETURNING id, invoice_id, amount, currency, method, source,
               external_reference, note, received_at, created_at`,
    [organisationId, input.invoiceId, moneyFromCents(amountCents), input.method, input.source || "manual", input.externalReference || null,
      input.note || null, normalizedIdempotencyKey, input.receivedAt || null, actorUserId || null],
  );
  const payment = inserted.rows[0];

  await recordLedgerEntry({
    organisationId,
    type: "payment_received",
    amount: payment.amount,
    currency: payment.currency,
    referenceType: "invoice_payment",
    referenceId: String(payment.id),
    client,
  });

  const accounting = await recordInvoicePaymentAccounting({
    client,
    organisationId,
    paymentId: payment.id,
    invoiceNumber: summaryBefore.invoice_number,
    amount: payment.amount,
    receivedAt: payment.received_at,
    createdBy: actorUserId,
  });

  const remainingCents = balanceCents - amountCents;
  if (remainingCents === 0) {
    await client.query(
      `UPDATE invoices SET status = 'paid', version = version + 1
       WHERE id = $1 AND organisation_id = $2`,
      [input.invoiceId, organisationId],
    );
    await client.query(
      `UPDATE payment_reminder_attempts SET status = 'stopped', updated_at = NOW()
       WHERE organisation_id = $1 AND invoice_id = $2 AND status = 'queued'`,
      [organisationId, input.invoiceId],
    );
  }

  const summary = await loadInvoiceBalance({ invoiceId: input.invoiceId, organisationId, client });
  const event = await appendEvent(client, {
    organisationId,
    eventType: "payment.received",
    aggregateType: "invoice",
    aggregateId: input.invoiceId,
    actorUserId,
    correlationId,
    occurredAt: payment.received_at,
    metadata: { transactionId, policyVersions: [INVOICE_PAYMENT_POLICY], idempotencyKey: normalizedIdempotencyKey },
    payload: {
      paymentId: payment.id,
      invoiceId: input.invoiceId,
      invoiceNumber: summaryBefore.invoice_number,
      amount: Number(payment.amount),
      currency: payment.currency,
      method: payment.method,
      remainingBalance: Number(summary.balance),
      status: summary.status,
      accountingEntryId: accounting.entryId || null,
    },
  });

  const trust = await persistTrustAssessment(client, {
    organisationId,
    transactionId,
    correlationId,
    checks: [
      { code: "invoice_payment.persisted", passed: Boolean(payment.id), evidence: [{ paymentId: payment.id }] },
      { code: "invoice_payment.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id || null }] },
      { code: "invoice_payment.balance_valid", passed: Number(summary.balance) >= 0, evidence: [{ balance: summary.balance, status: summary.status }] },
      {
        code: "invoice_payment.accounting_recorded",
        passed: Boolean(accounting.entryId),
        severity: accounting.entryId ? "info" : "warning",
        explanation: accounting.entryId ? null : "Le plan comptable n’est pas initialisé; aucune écriture approximative n’a été créée.",
        evidence: [{ accountingEntryId: accounting.entryId || null, reason: accounting.reason || null }],
      },
    ],
  });

  const graph = await persistGraphEdges(client, {
    organisationId,
    transactionId,
    correlationId,
    edges: [
      { from: { type: "invoice", id: input.invoiceId }, relation: "settled_by", to: { type: "invoice_payment", id: payment.id }, provenance: { eventId: event.event_id } },
      { from: { type: "invoice_payment", id: payment.id }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } },
      ...(accounting.entryId ? [{ from: { type: "invoice_payment", id: payment.id }, relation: "accounted_as", to: { type: "accounting_entry", id: accounting.entryId }, provenance: { eventId: event.event_id } }] : []),
      { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: "invoice_payment", id: payment.id }, provenance: { transactionId } },
    ],
  });

  return { duplicate: false, payment, summary, accounting, event, trust, graph };
}

async function verifyInvoicePayment({ result }) {
  if (!result || result.duplicate) return;
  if (!result.payment?.id) throw Object.assign(new Error("Le paiement client n’a pas été persisté."), { statusCode: 500 });
  if (!result.event?.event_id) throw Object.assign(new Error("L’événement payment.received est absent."), { statusCode: 500 });
  if (!result.trust?.assessmentId) throw Object.assign(new Error("Le constat MADTrust du paiement client est absent."), { statusCode: 500 });
  if (!Array.isArray(result.graph) || result.graph.length < 3) throw Object.assign(new Error("Le graphe métier du paiement client est incomplet."), { statusCode: 500 });
  if (Number(result.summary?.balance) < 0) throw Object.assign(new Error("Le solde client final est incohérent."), { statusCode: 500 });
}

async function recordInvoicePayment({ invoiceId, organisationId, amount, method, source = "manual", externalReference, note, idempotencyKey, receivedAt, createdBy }) {
  const transaction = await executeTransaction({
    type: "invoice.payment.receive",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [INVOICE_PAYMENT_POLICY],
    input: { invoiceId, amount, method, source, externalReference, note, receivedAt },
    execute: executeInvoicePayment,
    verify: verifyInvoicePayment,
  });
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

module.exports = {
  PAYMENT_METHODS,
  INVOICE_PAYMENT_POLICY,
  cents,
  evaluateInvoicePaymentPolicy,
  executeInvoicePayment,
  verifyInvoicePayment,
  loadInvoiceBalance,
  listInvoicePayments,
  recordInvoicePayment,
};
