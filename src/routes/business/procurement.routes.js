const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
const { calculateTotals } = require('../../services/business/procurement-transaction.service');

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

router.get('/requisitions', (req, res, next) => handle(res, next, async () => (await db.pool.query(
  'SELECT * FROM procurement_requisitions WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)],
)).rows));

router.post('/requisitions', (req, res, next) => handle(res, next, async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const totals = calculateTotals(req.body.items || [], 0);
    const inserted = await client.query(`INSERT INTO procurement_requisitions
      (organisation_id,requisition_number,title,justification,requested_by,needed_by,currency,estimated_total,budget_code,idempotency_key,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [org(req), req.body.requisitionNumber, req.body.title, req.body.justification, actor(req), req.body.neededBy || null, req.body.currency || 'CAD', totals.subtotal, req.body.budgetCode || null, key(req), actor(req)]);
    for (const item of req.body.items || []) {
      await client.query(`INSERT INTO procurement_requisition_items
        (organisation_id,requisition_id,description,quantity,unit_price,inventory_item_id,asset_category,metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [org(req), inserted.rows[0].id, item.description, item.quantity, item.unitPrice || 0, item.inventoryItemId || null, item.assetCategory || null, item.metadata || {}]);
    }
    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}, 201));

router.get('/orders', (req, res, next) => handle(res, next, async () => (await db.pool.query(
  'SELECT * FROM procurement_purchase_orders WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)],
)).rows));

router.post('/orders', (req, res, next) => handle(res, next, async () => {
  const totals = calculateTotals(req.body.items || [], req.body.taxes || 0);
  return (await db.pool.query(`INSERT INTO procurement_purchase_orders
    (organisation_id,purchase_order_number,requisition_id,supplier_id,currency,subtotal,taxes,total,expected_at,terms,evidence,idempotency_key,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
  [org(req), req.body.purchaseOrderNumber, req.body.requisitionId || null, req.body.supplierId || null, req.body.currency || 'CAD', totals.subtotal, totals.taxes, totals.total, req.body.expectedAt || null, req.body.terms || {}, req.body.evidence || [], key(req), actor(req)])).rows[0];
}, 201));

router.get('/receipts', (req, res, next) => handle(res, next, async () => (await db.pool.query(
  'SELECT * FROM procurement_receipts WHERE organisation_id=$1 ORDER BY received_at DESC', [org(req)],
)).rows));

router.post('/receipts', (req, res, next) => handle(res, next, async () => (await db.pool.query(`INSERT INTO procurement_receipts
  (organisation_id,purchase_order_id,receipt_number,received_by,status,condition_notes,evidence,idempotency_key)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
[org(req), req.body.purchaseOrderId, req.body.receiptNumber, actor(req), req.body.status || 'received', req.body.conditionNotes || null, req.body.evidence || [], key(req)])).rows[0], 201));

router.get('/supplier-invoices', (req, res, next) => handle(res, next, async () => (await db.pool.query(
  'SELECT * FROM procurement_supplier_invoices WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)],
)).rows));

router.get('/alerts', (req, res, next) => handle(res, next, async () => {
  const organisationId = org(req);
  const [pending, overdue, exceptions] = await Promise.all([
    db.pool.query("SELECT * FROM procurement_requisitions WHERE organisation_id=$1 AND status='submitted' ORDER BY created_at", [organisationId]),
    db.pool.query("SELECT * FROM procurement_purchase_orders WHERE organisation_id=$1 AND status NOT IN ('received','closed','cancelled') AND expected_at<CURRENT_DATE ORDER BY expected_at", [organisationId]),
    db.pool.query("SELECT * FROM procurement_supplier_invoices WHERE organisation_id=$1 AND status='exception' ORDER BY created_at", [organisationId]),
  ]);
  return { pendingApprovals: pending.rows, overdueOrders: overdue.rows, invoiceExceptions: exceptions.rows };
}));

module.exports = router;
