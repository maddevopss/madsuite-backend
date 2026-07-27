const db = require('../../../db');

function computeBatchTotals(items = []) {
  return items.reduce((totals, item) => {
    const requested = Number(item.requestedAmount || 0);
    const discount = Number(item.earlyPaymentDiscount || 0);
    const withholding = Number(item.withholdingAmount || 0);
    const payable = Number((requested - discount - withholding).toFixed(2));
    if (requested <= 0 || discount < 0 || withholding < 0 || payable < 0) {
      const error = new Error('supplier.invalid_payment_amounts'); error.statusCode = 400; throw error;
    }
    totals.grossTotal += requested;
    totals.discountTotal += discount;
    totals.withholdingTotal += withholding;
    totals.netTotal += payable;
    totals.lines.push({ ...item, payableAmount: payable });
    return totals;
  }, { grossTotal: 0, discountTotal: 0, withholdingTotal: 0, netTotal: 0, lines: [] });
}

async function requestApproval({ organisationId, billId, policyId, actorUserId, idempotencyKey }) {
  const bill = (await db.pool.query('SELECT * FROM supplier_bills WHERE organisation_id=$1 AND id=$2', [organisationId, billId])).rows[0];
  if (!bill) return null;
  if (!['matched','approved'].includes(bill.matching_status)) { const error = new Error('supplier.bill_not_matched'); error.statusCode = 409; throw error; }
  const policy = (await db.pool.query(`SELECT * FROM supplier_approval_policies WHERE organisation_id=$1 AND is_active AND ($2::bigint IS NULL OR id=$2)
    AND minimum_amount <= $3 AND (maximum_amount IS NULL OR maximum_amount >= $3) ORDER BY CASE WHEN id=$2 THEN 0 ELSE 1 END,minimum_amount DESC LIMIT 1`, [organisationId, policyId || null, bill.total])).rows[0];
  if (!policy) { const error = new Error('supplier.approval_policy_required'); error.statusCode = 400; throw error; }
  const approval = (await db.pool.query(`INSERT INTO supplier_bill_approvals
    (organisation_id,supplier_bill_id,policy_id,sequence_number,requested_by,idempotency_key)
    VALUES ($1,$2,$3,1,$4,$5) ON CONFLICT (organisation_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`, [organisationId,billId,policy.id,actorUserId || null,idempotencyKey])).rows[0];
  return { approval, policy };
}

async function decideApproval({ organisationId, approvalId, decision, reason, actorUserId }) {
  if (!['approved','rejected'].includes(decision)) { const error = new Error('supplier.invalid_approval_decision'); error.statusCode = 400; throw error; }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const approval = (await client.query(`SELECT a.*,p.require_distinct_requester FROM supplier_bill_approvals a
      JOIN supplier_approval_policies p ON p.organisation_id=a.organisation_id AND p.id=a.policy_id
      WHERE a.organisation_id=$1 AND a.id=$2 FOR UPDATE`, [organisationId,approvalId])).rows[0];
    if (!approval) return null;
    if (approval.require_distinct_requester && Number(approval.requested_by) === Number(actorUserId)) { const error = new Error('supplier.approver_must_be_distinct'); error.statusCode = 409; throw error; }
    const updated = (await client.query(`UPDATE supplier_bill_approvals SET status=$3,decision_reason=$4,decided_by=$5,decided_at=NOW()
      WHERE organisation_id=$1 AND id=$2 AND status='pending' RETURNING *`, [organisationId,approvalId,decision,reason || null,actorUserId || null])).rows[0];
    if (updated && decision === 'approved') await client.query(`UPDATE supplier_bills SET status='approved' WHERE organisation_id=$1 AND id=$2`, [organisationId,updated.supplier_bill_id]);
    await client.query('COMMIT');
    return updated;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function createPaymentBatch({ organisationId, payload, actorUserId }) {
  const totals = computeBatchTotals(payload.items || []);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const duplicate = (await client.query('SELECT * FROM supplier_payment_batches WHERE organisation_id=$1 AND idempotency_key=$2', [organisationId,payload.idempotencyKey])).rows[0];
    if (duplicate) { await client.query('COMMIT'); return { duplicate: true, batch: duplicate }; }
    const batch = (await client.query(`INSERT INTO supplier_payment_batches
      (organisation_id,batch_number,scheduled_for,currency,gross_total,discount_total,withholding_total,net_total,prepared_by,idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [organisationId,payload.batchNumber,payload.scheduledFor,payload.currency || 'CAD',totals.grossTotal,totals.discountTotal,totals.withholdingTotal,totals.netTotal,actorUserId || null,payload.idempotencyKey])).rows[0];
    for (const line of totals.lines) {
      const bill = (await client.query(`SELECT b.*,a.requested_by,p.require_distinct_payer FROM supplier_bills b
        LEFT JOIN supplier_bill_approvals a ON a.organisation_id=b.organisation_id AND a.supplier_bill_id=b.id AND a.status='approved'
        LEFT JOIN supplier_approval_policies p ON p.organisation_id=a.organisation_id AND p.id=a.policy_id
        WHERE b.organisation_id=$1 AND b.id=$2 AND b.status IN ('approved','partially_paid')`, [organisationId,line.billId])).rows[0];
      if (!bill) { const error = new Error('supplier.bill_not_approved'); error.statusCode = 409; throw error; }
      if (bill.require_distinct_payer && Number(bill.requested_by) === Number(actorUserId)) { const error = new Error('supplier.payer_must_be_distinct'); error.statusCode = 409; throw error; }
      await client.query(`INSERT INTO supplier_payment_batch_items
        (organisation_id,payment_batch_id,supplier_bill_id,requested_amount,early_payment_discount,withholding_amount,payable_amount,payment_method)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [organisationId,batch.id,line.billId,line.requestedAmount,line.earlyPaymentDiscount || 0,line.withholdingAmount || 0,line.payableAmount,line.paymentMethod || null]);
    }
    await client.query('COMMIT');
    return { duplicate: false, batch, totals };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

module.exports = { computeBatchTotals, requestApproval, decideApproval, createPaymentBatch };
