const { ACCOUNT_CODES, loadAccounts, recordPostedEntry, money } = require("./accounting-sync.service");
const { appendEvent } = require("./business-event.service");
const {
  executeTransaction,
  registerPolicy,
} = require("./transaction-engine.service");
const {
  persistTrustAssessment,
  persistGraphEdges,
} = require("./trust-persistence.service");

const SUPPLIER_PAYMENT_POLICY = "supplier.payment.post@1";

function evaluateSupplierPaymentPolicy({ input, idempotencyKey }) {
  if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    return {
      allowed: false,
      reason: "Une clé d’idempotence est requise.",
      statusCode: 400,
      code: "supplier_payment.idempotency_key_required",
    };
  }

  const amount = Number(input?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      allowed: false,
      reason: "Le montant du paiement fournisseur doit être supérieur à zéro.",
      statusCode: 400,
      code: "supplier_payment.amount_invalid",
    };
  }

  if (input?.billId === undefined || input?.billId === null || input?.billId === "") {
    return {
      allowed: false,
      reason: "Une facture fournisseur est requise.",
      statusCode: 400,
      code: "supplier_payment.bill_required",
    };
  }

  return {
    allowed: true,
    code: "supplier_payment.input_valid",
  };
}

registerPolicy("supplier.payment.post", "1", evaluateSupplierPaymentPolicy);

async function executeSupplierPayment({
  client,
  transactionId,
  correlationId,
  organisationId,
  actorUserId,
  idempotencyKey,
  input,
}) {
  const normalizedAmount = money(input.amount);

  const duplicate = await client.query(
    `SELECT p.*, b.status bill_status
     FROM supplier_payments p
     JOIN supplier_bills b ON b.id = p.supplier_bill_id
     WHERE p.organisation_id = $1 AND p.idempotency_key = $2`,
    [organisationId, idempotencyKey],
  );
  if (duplicate.rows[0]) {
    return { payment: duplicate.rows[0], duplicate: true };
  }

  const billResult = await client.query(
    `SELECT b.*,
            COALESCE((SELECT SUM(p.amount) FROM supplier_payments p
                      WHERE p.supplier_bill_id = b.id AND p.organisation_id = b.organisation_id
                        AND p.reversed_at IS NULL), 0) AS paid_total
     FROM supplier_bills b
     WHERE b.id = $1 AND b.organisation_id = $2
     FOR UPDATE OF b`,
    [input.billId, organisationId],
  );
  const bill = billResult.rows[0];
  if (!bill) return null;

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
    [
      organisationId,
      input.billId,
      normalizedAmount,
      input.paidAt || new Date(),
      input.paymentMethod || null,
      input.reference || null,
      idempotencyKey,
      actorUserId || null,
    ],
  );
  const payment = paymentResult.rows[0];

  const accounts = await loadAccounts(client, organisationId, [ACCOUNT_CODES.payables, ACCOUNT_CODES.bank]);
  let accounting = { skipped: true, reason: "chart_of_accounts_not_initialized" };
  if (accounts.has(ACCOUNT_CODES.payables) && accounts.has(ACCOUNT_CODES.bank)) {
    accounting = await recordPostedEntry(client, {
      organisationId,
      userId: actorUserId,
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
    [status, input.billId, organisationId],
  );

  const event = await appendEvent(client, {
    organisationId,
    eventType: "supplier.payment.posted",
    aggregateType: "supplier_bill",
    aggregateId: input.billId,
    actorUserId,
    occurredAt: payment.paid_at,
    correlationId,
    metadata: {
      transactionId,
      policyVersions: [SUPPLIER_PAYMENT_POLICY],
    },
    payload: {
      paymentId: payment.id,
      billId: input.billId,
      supplierId: bill.supplier_id,
      amount: normalizedAmount,
      remainingBalance: Number((Number(bill.total) - newPaidTotal).toFixed(2)),
      status,
      accountingEntryId: accounting.entryId || null,
    },
  });

  const trust = await persistTrustAssessment(client, {
    organisationId,
    transactionId,
    correlationId,
    checks: [
      {
        code: "supplier_payment.persisted",
        passed: Boolean(payment.id),
        severity: "critical",
        evidence: [{ type: "supplier_payment", id: String(payment.id) }],
      },
      {
        code: "supplier_payment.event_recorded",
        passed: Boolean(event.event_id),
        severity: "critical",
        evidence: [{ type: "business_event", id: String(event.event_id) }],
      },
      {
        code: "supplier_payment.accounting_recorded",
        passed: Boolean(accounting.entryId),
        severity: accounting.skipped ? "warning" : "critical",
        explanation: accounting.skipped ? "Le plan comptable n’est pas initialisé." : null,
        evidence: accounting.entryId ? [{ type: "accounting_entry", id: String(accounting.entryId) }] : [],
      },
      {
        code: "supplier_bill.status_coherent",
        passed: ["partially_paid", "paid"].includes(status),
        severity: "critical",
        evidence: [{ type: "supplier_bill", id: String(input.billId), status }],
      },
    ],
  });

  const graphEdges = await persistGraphEdges(client, {
    organisationId,
    transactionId,
    correlationId,
    edges: [
      {
        from: { type: "supplier_bill", id: input.billId },
        relation: "settled_by",
        to: { type: "supplier_payment", id: payment.id },
        provenance: { eventId: event.event_id, transactionId },
      },
      ...(accounting.entryId ? [{
        from: { type: "supplier_payment", id: payment.id },
        relation: "posted_as",
        to: { type: "accounting_entry", id: accounting.entryId },
        provenance: { eventId: event.event_id, transactionId },
      }] : []),
      {
        from: { type: "supplier_payment", id: payment.id },
        relation: "produced",
        to: { type: "business_event", id: event.event_id },
        provenance: { transactionId },
      },
      {
        from: { type: "madtrust_assessment", id: trust.assessmentId },
        relation: "assesses",
        to: { type: "supplier_payment", id: payment.id },
        provenance: { transactionId },
      },
    ],
  });

  return {
    payment: { ...payment, accounting_entry_id: accounting.entryId || null },
    accounting,
    event,
    trust,
    graphEdges,
    status,
    duplicate: false,
  };
}

async function verifySupplierPayment({ result }) {
  if (!result || result.duplicate) return;
  if (!result.payment?.id) {
    throw Object.assign(new Error("Le paiement fournisseur n’a pas été persisté."), { statusCode: 500 });
  }
  if (!result.event?.event_id) {
    throw Object.assign(new Error("L’événement du paiement fournisseur est absent."), { statusCode: 500 });
  }
  if (!result.trust?.assessmentId) {
    throw Object.assign(new Error("Le constat MADTrust du paiement fournisseur est absent."), { statusCode: 500 });
  }
  if (!Array.isArray(result.graphEdges) || result.graphEdges.length < 3) {
    throw Object.assign(new Error("Le graphe métier du paiement fournisseur est incomplet."), { statusCode: 500 });
  }
  if (!result.status || !["partially_paid", "paid"].includes(result.status)) {
    throw Object.assign(new Error("Le statut final de la facture fournisseur est incohérent."), { statusCode: 500 });
  }
}

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
  const transaction = await executeTransaction({
    type: "supplier.payment.post",
    organisationId,
    actorUserId: createdBy,
    idempotencyKey,
    policies: [SUPPLIER_PAYMENT_POLICY],
    input: { billId, amount, paidAt, paymentMethod, reference },
    execute: executeSupplierPayment,
    verify: verifySupplierPayment,
  });

  if (!transaction.result) return null;
  return {
    ...transaction.result,
    ct_mad: {
      transactionId: transaction.transactionId,
      correlationId: transaction.correlationId,
      status: transaction.status,
      policies: transaction.policyResults,
      trustAssessmentId: transaction.result.trust?.assessmentId || null,
    },
  };
}

module.exports = {
  SUPPLIER_PAYMENT_POLICY,
  evaluateSupplierPaymentPolicy,
  executeSupplierPayment,
  verifySupplierPayment,
  recordSupplierPayment,
};
