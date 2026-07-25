const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");

const SUPPLIER_PAYMENT_REVERSAL_POLICY = "supplier.payment.reverse@1";

function evaluateSupplierPaymentReversalPolicy({ input, idempotencyKey }) {
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    return { allowed: false, statusCode: 400, code: "supplier_payment_reversal.idempotency_required", reason: "Une clé d’idempotence est requise." };
  }
  if (!input?.paymentId) {
    return { allowed: false, statusCode: 400, code: "supplier_payment_reversal.payment_required", reason: "Un paiement fournisseur est requis." };
  }
  if (!input?.reason || String(input.reason).trim().length < 5) {
    return { allowed: false, statusCode: 400, code: "supplier_payment_reversal.reason_required", reason: "Une raison de renversement explicite est requise." };
  }
  return { allowed: true, code: "supplier_payment_reversal.input_valid" };
}

registerPolicy("supplier.payment.reverse", "1", evaluateSupplierPaymentReversalPolicy);

async function createReversalEntry(client, { organisationId, originalEntryId, paymentId, createdBy, reversedAt, reason }) {
  if (!originalEntryId) return { skipped: true, reason: "original_accounting_entry_absent" };
  const original = await client.query(
    `SELECT e.*, j.code journal_code FROM accounting_entries e
     JOIN accounting_journals j ON j.id=e.journal_id
     WHERE e.organisation_id=$1 AND e.id=$2 AND e.status='posted' FOR UPDATE`,
    [organisationId, originalEntryId],
  );
  if (!original.rows[0]) return { skipped: true, reason: "original_accounting_entry_unavailable" };
  const lines = await client.query(
    `SELECT account_id, description, credit AS debit, debit AS credit
     FROM accounting_entry_lines WHERE organisation_id=$1 AND entry_id=$2 ORDER BY id`,
    [organisationId, originalEntryId],
  );
  const entry = await client.query(
    `INSERT INTO accounting_entries
      (organisation_id,journal_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,created_by)
     VALUES ($1,$2,$3,$4,$5,'supplier_payment_reversal',$6,'draft',NULL,$7) RETURNING id`,
    [organisationId, original.rows[0].journal_id, `REV-FOU-${paymentId}`, new Date(reversedAt).toISOString().slice(0,10), reason, String(paymentId), createdBy || null],
  );
  for (const line of lines.rows) {
    await client.query(
      `INSERT INTO accounting_entry_lines
       (organisation_id,entry_id,account_id,description,debit,credit) VALUES ($1,$2,$3,$4,$5,$6)`,
      [organisationId, entry.rows[0].id, line.account_id, line.description, line.debit, line.credit],
    );
  }
  await client.query("UPDATE accounting_entries SET status='posted', posted_at=NOW() WHERE id=$1 AND organisation_id=$2", [entry.rows[0].id, organisationId]);
  return { skipped: false, entryId: entry.rows[0].id };
}

async function executeSupplierPaymentReversal({ client, transactionId, correlationId, organisationId, actorUserId, idempotencyKey, input }) {
  const paymentResult = await client.query(
    `SELECT p.*, b.total bill_total FROM supplier_payments p
     JOIN supplier_bills b ON b.id=p.supplier_bill_id AND b.organisation_id=p.organisation_id
     WHERE p.id=$1 AND p.organisation_id=$2 FOR UPDATE OF p,b`,
    [input.paymentId, organisationId],
  );
  const payment = paymentResult.rows[0];
  if (!payment) return null;
  if (payment.reversed_at) return { duplicate: true, payment };

  const reversedAt = input.reversedAt || new Date();
  const accounting = await createReversalEntry(client, {
    organisationId,
    originalEntryId: payment.accounting_entry_id,
    paymentId: payment.id,
    createdBy: actorUserId,
    reversedAt,
    reason: input.reason,
  });
  const updated = await client.query(
    `UPDATE supplier_payments SET reversed_at=$1,reversal_reason=$2,reversal_idempotency_key=$3,
      reversed_by=$4,reversal_accounting_entry_id=$5 WHERE id=$6 AND organisation_id=$7 RETURNING *`,
    [reversedAt, input.reason, idempotencyKey, actorUserId || null, accounting.entryId || null, payment.id, organisationId],
  );
  const totals = await client.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE reversed_at IS NULL),0)::numeric paid_total
     FROM supplier_payments WHERE organisation_id=$1 AND supplier_bill_id=$2`,
    [organisationId, payment.supplier_bill_id],
  );
  const paidTotal = Number(totals.rows[0].paid_total);
  const status = paidTotal === 0 ? "approved" : paidTotal < Number(payment.bill_total) ? "partially_paid" : "paid";
  await client.query("UPDATE supplier_bills SET status=$1 WHERE id=$2 AND organisation_id=$3", [status, payment.supplier_bill_id, organisationId]);

  const event = await appendEvent(client, {
    organisationId,
    eventType: "supplier.payment.reversed",
    aggregateType: "supplier_bill",
    aggregateId: payment.supplier_bill_id,
    actorUserId,
    correlationId,
    metadata: { transactionId, policyVersions: [SUPPLIER_PAYMENT_REVERSAL_POLICY] },
    payload: { paymentId: payment.id, amount: Number(payment.amount), reason: input.reason, status, reversalAccountingEntryId: accounting.entryId || null },
  });
  const trust = await persistTrustAssessment(client, {
    organisationId, transactionId, correlationId,
    checks: [
      { code: "payment.reversed", passed: Boolean(updated.rows[0]?.reversed_at), evidence: [{ paymentId: payment.id }] },
      { code: "reversal.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id }] },
      { code: "reversal.accounting_recorded", passed: Boolean(accounting.entryId) || accounting.skipped, severity: accounting.skipped ? "warning" : "info", explanation: accounting.reason || null },
    ],
  });
  const graph = await persistGraphEdges(client, {
    organisationId, transactionId, correlationId,
    edges: [
      { from: { type: "supplier_payment", id: payment.id }, relation: "reversed_by", to: { type: "business_event", id: event.event_id }, provenance: { transactionId } },
      ...(accounting.entryId ? [{ from: { type: "supplier_payment", id: payment.id }, relation: "reversed_as", to: { type: "accounting_entry", id: accounting.entryId }, provenance: { transactionId } }] : []),
    ],
  });
  return { duplicate: false, payment: updated.rows[0], accounting, event, trust, graph, status };
}

async function verifySupplierPaymentReversal({ result }) {
  if (!result || result.duplicate) return;
  if (!result.payment?.reversed_at) throw Object.assign(new Error("Le paiement fournisseur n’a pas été renversé."), { statusCode: 500 });
  if (!result.event?.event_id) throw Object.assign(new Error("L’événement de renversement est absent."), { statusCode: 500 });
  if (!result.trust?.assessmentId) throw Object.assign(new Error("Le constat MADTrust du renversement est absent."), { statusCode: 500 });
}

async function reverseSupplierPayment({ organisationId, paymentId, reason, reversedAt, idempotencyKey, createdBy }) {
  const transaction = await executeTransaction({
    type: "supplier.payment.reverse", organisationId, actorUserId: createdBy, idempotencyKey,
    policies: [SUPPLIER_PAYMENT_REVERSAL_POLICY], input: { paymentId, reason, reversedAt },
    execute: executeSupplierPaymentReversal, verify: verifySupplierPaymentReversal,
  });
  if (!transaction.result) return null;
  return { ...transaction.result, ct_mad: { transactionId: transaction.transactionId, correlationId: transaction.correlationId, status: transaction.status, policies: transaction.policyResults } };
}

module.exports = { SUPPLIER_PAYMENT_REVERSAL_POLICY, evaluateSupplierPaymentReversalPolicy, verifySupplierPaymentReversal, reverseSupplierPayment };
