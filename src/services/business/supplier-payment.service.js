const db = require("../../../db");
const { ACCOUNT_CODES, loadAccounts, recordPostedEntry, money } = require("./accounting-sync.service");
const { appendEvent } = require("./business-event.service");

async function recordSupplierPayment({
  organisationId,
  billId,
  amount,
  paidAt,
  paymentMethod,
  reference,
  idempotencyKey,
  createdBy,
}) {
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    throw Object.assign(new Error("Une clé d’idempotence est requise."), { statusCode: 400 });
  }
  const normalizedAmount = money(amount);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const duplicate = await client.query(
      `SELECT p.*, b.status bill_status
       FROM supplier_payments p
       JOIN supplier_bills b ON b.id = p.supplier_bill_id
       WHERE p.organisation_id = $1 AND p.idempotency_key = $2`,
      [organisationId, idempotencyKey],
    );
    if (duplicate.rows[0]) {
      await client.query("COMMIT");
      return { payment: duplicate.rows[0], duplicate: true };
    }

    const billResult = await client.query(
      `SELECT b.*,
              COALESCE(SUM(p.amount) FILTER (WHERE p.reversed_at IS NULL), 0) paid_total
       FROM supplier_bills b
       LEFT JOIN supplier_payments p ON p.supplier_bill_id = b.id AND p.organisation_id = b.organisation_id
       WHERE b.id = $1 AND b.organisation_id = $2
       GROUP BY b.id
       FOR UPDATE OF b`,
      [billId, organisationId],
    );
    const bill = billResult.rows[0];
    if (!bill) {
      await client.query("ROLLBACK");
      return null;
    }
    if (!["approved", "partially_paid"].includes(bill.status)) {
      throw Object.assign(new Error("La facture fournisseur doit être approuvée et impayée."), { statusCode: 409 });
    }

    const remaining = Number((Number(bill.total) - Number(bill.paid_total)).toFixed(2));
    if (normalizedAmount > remaining) {
      throw Object.assign(new Error("Le paiement dépasse le solde fournisseur restant."), { statusCode: 409 });
    }

    const paymentResult = await client.query(
      `INSERT INTO supplier_payments
        (organisation_id, supplier_bill_id, amount, paid_at, payment_method, reference, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [organisationId, billId, normalizedAmount, paidAt || new Date(), paymentMethod || null, reference || null, idempotencyKey, createdBy || null],
    );
    const payment = paymentResult.rows[0];

    const accounts = await loadAccounts(client, organisationId, [ACCOUNT_CODES.payables, ACCOUNT_CODES.bank]);
    let accounting = { skipped: true, reason: "chart_of_accounts_not_initialized" };
    if (accounts.has(ACCOUNT_CODES.payables) && accounts.has(ACCOUNT_CODES.bank)) {
      accounting = await recordPostedEntry(client, {
        organisationId,
        userId: createdBy,
        journalCode: "DEC",
        journalName: "Journal des décaissements",
        journalType: "cash_disbursements",
        entryNumber: `DEC-FOU-${payment.id}`,
        entryDate: new Date(payment.paid_at).toISOString().slice(0, 10),
        description: `Paiement fournisseur ${bill.bill_number}`,
        sourceType: "supplier_payment",
        sourceId: payment.id,
        lines: [
          { accountId: accounts.get(ACCOUNT_CODES.payables), description: "Réduction du compte fournisseur", debit: normalizedAmount, credit: 0 },
          { accountId: accounts.get(ACCOUNT_CODES.bank), description: "Décaissement bancaire", debit: 0, credit: normalizedAmount },
        ],
      });
      await client.query(
        "UPDATE supplier_payments SET accounting_entry_id = $1 WHERE id = $2 AND organisation_id = $3",
        [accounting.entryId, payment.id, organisationId],
      );
    }

    const newPaidTotal = Number((Number(bill.paid_total) + normalizedAmount).toFixed(2));
    const status = newPaidTotal === Number(bill.total) ? "paid" : "partially_paid";
    await client.query(
      "UPDATE supplier_bills SET status = $1 WHERE id = $2 AND organisation_id = $3",
      [status, billId, organisationId],
    );

    const event = await appendEvent(client, {
      organisationId,
      eventType: "supplier.payment.posted",
      aggregateType: "supplier_bill",
      aggregateId: billId,
      actorUserId: createdBy,
      occurredAt: payment.paid_at,
      payload: {
        paymentId: payment.id,
        billId,
        supplierId: bill.supplier_id,
        amount: normalizedAmount,
        remainingBalance: Number((Number(bill.total) - newPaidTotal).toFixed(2)),
        status,
      },
    });

    await client.query("COMMIT");
    return { payment: { ...payment, accounting_entry_id: accounting.entryId || null }, accounting, event, status, duplicate: false };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { recordSupplierPayment };
