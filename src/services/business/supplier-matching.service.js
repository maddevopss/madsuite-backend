const db = require('../../../db');

const round = (value, precision = 2) => Number(Number(value || 0).toFixed(precision));
const variancePercent = (expected, actual) => expected === 0 ? (actual === 0 ? 0 : 100) : round(((actual - expected) / expected) * 100, 6);

function evaluateLine({ billLine, orderLine, receiptLine, policy }) {
  const exceptions = [];
  if (!orderLine) exceptions.push({ exceptionType: 'missing_order' });
  if (policy.matching_mode === 'three_way' && !receiptLine) exceptions.push({ exceptionType: 'missing_receipt' });

  if (orderLine) {
    const priceVariance = variancePercent(Number(orderLine.unit_price), Number(billLine.unit_price));
    if (Math.abs(priceVariance) > Number(policy.price_tolerance_percent)) {
      exceptions.push({ exceptionType: 'price', expectedValue: orderLine.unit_price, actualValue: billLine.unit_price, variancePercent: priceVariance, varianceValue: round(Number(billLine.unit_price) - Number(orderLine.unit_price), 4) });
    }
  }

  const quantityReference = policy.matching_mode === 'three_way' ? receiptLine?.quantity_received : orderLine?.quantity;
  if (quantityReference !== undefined && quantityReference !== null) {
    const quantityVariance = variancePercent(Number(quantityReference), Number(billLine.quantity));
    if (Math.abs(quantityVariance) > Number(policy.quantity_tolerance_percent)) {
      exceptions.push({ exceptionType: 'quantity', expectedValue: quantityReference, actualValue: billLine.quantity, variancePercent: quantityVariance, varianceValue: round(Number(billLine.quantity) - Number(quantityReference), 3) });
    }
  }
  return exceptions;
}

async function runMatching({ organisationId, billId, policyId, actorUserId, idempotencyKey }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationId)]);
    const duplicate = (await client.query('SELECT * FROM supplier_matching_runs WHERE organisation_id=$1 AND idempotency_key=$2', [organisationId, idempotencyKey])).rows[0];
    if (duplicate) { await client.query('COMMIT'); return { duplicate: true, run: duplicate }; }

    const bill = (await client.query('SELECT * FROM supplier_bills WHERE organisation_id=$1 AND id=$2 FOR UPDATE', [organisationId, billId])).rows[0];
    if (!bill) return null;
    const policy = (await client.query(`SELECT * FROM supplier_matching_policies WHERE organisation_id=$1 AND is_active
      AND ($2::bigint IS NULL OR id=$2) ORDER BY CASE WHEN id=$2 THEN 0 WHEN is_default THEN 1 ELSE 2 END LIMIT 1`, [organisationId, policyId || null])).rows[0];
    if (!policy) { const error = new Error('supplier.matching_policy_required'); error.statusCode = 400; throw error; }

    const lines = (await client.query('SELECT * FROM supplier_bill_lines WHERE organisation_id=$1 AND supplier_bill_id=$2 ORDER BY id', [organisationId, billId])).rows;
    const allExceptions = [];
    for (const line of lines) {
      const orderLine = line.purchase_order_line_id ? (await client.query('SELECT * FROM inventory_purchase_order_lines WHERE organisation_id=$1 AND id=$2', [organisationId, line.purchase_order_line_id])).rows[0] : null;
      const receiptLine = line.receipt_line_id ? (await client.query('SELECT * FROM inventory_receipt_lines WHERE organisation_id=$1 AND id=$2', [organisationId, line.receipt_line_id])).rows[0] : null;
      evaluateLine({ billLine: line, orderLine, receiptLine, policy }).forEach((item) => allExceptions.push({ ...item, lineId: line.id }));
    }

    const taxVariance = round(Number(bill.tax_total) - Number(bill.matching_summary?.expectedTax || bill.tax_total));
    if (Math.abs(taxVariance) > Number(policy.tax_tolerance_amount)) allExceptions.push({ exceptionType: 'tax', expectedValue: Number(bill.tax_total) - taxVariance, actualValue: bill.tax_total, varianceValue: taxVariance });

    const status = allExceptions.length ? 'exception' : (policy.auto_approve_within_tolerance ? 'approved' : 'matched');
    for (const exception of allExceptions) {
      await client.query(`INSERT INTO supplier_matching_exceptions
        (organisation_id,supplier_bill_id,supplier_bill_line_id,exception_type,expected_value,actual_value,variance_value,variance_percent)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [organisationId, billId, exception.lineId || null, exception.exceptionType, exception.expectedValue ?? null, exception.actualValue ?? null, exception.varianceValue ?? null, exception.variancePercent ?? null]);
    }
    const summary = { lineCount: lines.length, exceptionCount: allExceptions.length, matchingMode: policy.matching_mode, withinTolerance: allExceptions.length === 0 };
    const run = (await client.query(`INSERT INTO supplier_matching_runs
      (organisation_id,supplier_bill_id,policy_id,result_status,summary,idempotency_key,executed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [organisationId, billId, policy.id, status, summary, idempotencyKey, actorUserId || null])).rows[0];
    await client.query(`UPDATE supplier_bills SET matching_status=$3, matching_mode=$4, matching_summary=$5, blocked_reason=$6 WHERE organisation_id=$1 AND id=$2`, [organisationId, billId, status, policy.matching_mode, summary, allExceptions.length ? 'supplier.matching_outside_tolerance' : null]);
    await client.query('COMMIT');
    return { duplicate: false, run, exceptions: allExceptions, summary };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function resolveException({ organisationId, exceptionId, status, explanation, evidence, actorUserId }) {
  if (!['accepted','corrected','rejected'].includes(status)) { const error = new Error('supplier.invalid_exception_resolution'); error.statusCode = 400; throw error; }
  if (!String(explanation || '').trim()) { const error = new Error('supplier.exception_explanation_required'); error.statusCode = 400; throw error; }
  return (await db.pool.query(`UPDATE supplier_matching_exceptions SET status=$3, explanation=$4, evidence=$5, resolved_by=$6, resolved_at=NOW()
    WHERE organisation_id=$1 AND id=$2 AND status='open' RETURNING *`, [organisationId, exceptionId, status, explanation.trim(), evidence || [], actorUserId || null])).rows[0] || null;
}

module.exports = { evaluateLine, runMatching, resolveException };
