const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { recordLedgerEntry } = require("./invoice-ledger.service");
const { recordInvoicePaymentAccounting } = require("../business/accounting-sync.service");

const PAYMENT_METHODS = ["cash", "cheque", "bank_transfer", "card", "stripe", "other"];

function cents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.round((number + Number.EPSILON) * 100);
}

function moneyFromCents(value) {
  return (Number(value || 0) / 100).toFixed(2);
}

async function lockInvoice({ invoiceId, organisationId, client }) {
  const result = await client.query(
    `SELECT id
     FROM invoices
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
     LEFT JOIN invoice_payments p
       ON p.invoice_id = i.id AND p.organisation_id = i.organisation_id
     WHERE i.id = $1
       AND i.organisation_id = $2
       AND i.deleted_at IS NULL
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

async function recordInvoicePayment({
  invoiceId,
  organisationId,
  amount,
  method,
  source = "manual",
  externalReference,
  note,
  idempotencyKey,
  receivedAt,
  createdBy,
}) {
  const amountCents = cents(amount);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw Object.assign(new Error("Le montant du paiement doit être supérieur à zéro."), { statusCode: 400 });
  }
  if (!PAYMENT_METHODS.includes(method)) {
    throw Object.assign(new Error("Méthode de paiement invalide."), { statusCode: 400 });
  }
  if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
    throw Object.assign(new Error("Une clé d’idempotence valide est obligatoire."), { statusCode: 400 });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id, invoice_id, amount, currency, method, source,
              external_reference, note, received_at, created_at
       FROM invoice_payments
       WHERE organisation_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [organisationValue(organisationId), String(idempotencyKey).trim()],
    );

    if (existing.rows[0]) {
      if (Number(existing.rows[0].invoice_id) !== Number(invoiceId) || cents(existing.rows[0].amount) !== amountCents) {
        throw Object.assign(new Error("Cette clé d’idempotence est déjà utilisée pour un autre paiement."), { statusCode: 409 });
      }
      const summary = await loadInvoiceBalance({ invoiceId, organisationId, client, lock: true });
      await client.query("COMMIT");
      return { duplicate: true, payment: existing.rows[0], summary };
    }

    const summaryBefore = await loadInvoiceBalance({ invoiceId, organisationId, client, lock: true });
    if (!summaryBefore) {
      await client.query("ROLLBACK");
      return null;
    }
    if (!summaryBefore.finalized_at || !["sent", "paid"].includes(summaryBefore.status)) {
      throw Object.assign(new Error("Seule une facture finalisée et envoyée peut recevoir un paiement."), { statusCode: 409 });
    }

    const balanceCents = cents(summaryBefore.balance);
    if (balanceCents === 0) {
      throw Object.assign(new Error("Cette facture est déjà entièrement payée."), { statusCode: 409 });
    }
    if (amountCents > balanceCents) {
      throw Object.assign(new Error("Le paiement dépasse le solde restant."), {
        statusCode: 409,
        details: { balance: summaryBefore.balance },
      });
    }

    const inserted = await client.query(
      `INSERT INTO invoice_payments
        (organisation_id, invoice_id, amount, currency, method, source,
         external_reference, note, idempotency_key, received_at, created_by)
       VALUES ($1, $2, $3, 'CAD', $4, $5, $6, $7, $8,
               COALESCE($9::timestamptz, NOW()), $10)
       RETURNING id, invoice_id, amount, currency, method, source,
                 external_reference, note, received_at, created_at`,
      [
        organisationValue(organisationId),
        invoiceId,
        moneyFromCents(amountCents),
        method,
        source,
        externalReference || null,
        note || null,
        String(idempotencyKey).trim(),
        receivedAt || null,
        createdBy || null,
      ],
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
      organisationId: organisationValue(organisationId),
      paymentId: payment.id,
      invoiceNumber: summaryBefore.invoice_number,
      amount: payment.amount,
      receivedAt: payment.received_at,
      createdBy,
    });

    const remainingCents = balanceCents - amountCents;
    if (remainingCents === 0) {
      await client.query(
        `UPDATE invoices
         SET status = 'paid', version = version + 1
         WHERE id = $1 AND organisation_id = $2`,
        [invoiceId, organisationValue(organisationId)],
      );
      await client.query(
        `UPDATE payment_reminder_attempts
         SET status = 'stopped', updated_at = NOW()
         WHERE organisation_id = $1 AND invoice_id = $2 AND status = 'queued'`,
        [organisationValue(organisationId), invoiceId],
      );
    }

    const summary = await loadInvoiceBalance({ invoiceId, organisationId, client });
    await client.query("COMMIT");
    return { duplicate: false, payment, summary, accounting };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  PAYMENT_METHODS,
  cents,
  loadInvoiceBalance,
  listInvoicePayments,
  recordInvoicePayment,
};