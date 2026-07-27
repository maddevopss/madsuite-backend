const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const inventoryTransactionService = require('../../services/business/inventory-transaction.service');
const inventoryControlRoutes = require('./inventory-control.routes');
const inventoryProcurementRoutes = require('./inventory-procurement.routes');
const inventoryTraceabilityRoutes = require('./inventory-traceability.routes');

router.use(requireOrganisation);

router.get('/items', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT i.*,COALESCE(SUM(b.quantity),0)::numeric quantity_on_hand,
              COALESCE(SUM(b.inventory_value),0)::numeric inventory_value,
              CASE WHEN COALESCE(SUM(b.quantity),0)>0
                THEN (COALESCE(SUM(b.inventory_value),0)/SUM(b.quantity))::numeric ELSE 0 END average_cost
       FROM inventory_items i
       LEFT JOIN inventory_balances b ON b.organisation_id=i.organisation_id AND b.item_id=i.id
       WHERE i.organisation_id=$1 GROUP BY i.id ORDER BY i.name`,
      [req.organisationId],
    );
    return res.json({ items: rows });
  } catch (error) { return next(error); }
});

router.post('/items', requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!String(body.sku || '').trim() || !String(body.name || '').trim()) return res.status(400).json({ message: 'Le SKU et le nom sont obligatoires.' });
    const { rows } = await req.db.query(
      `INSERT INTO inventory_items
       (organisation_id,sku,name,description,unit,cost,sale_price,reorder_point,asset_account_id,expense_account_id,revenue_account_id,tracking_mode,shelf_life_days,expiry_warning_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.organisationId,String(body.sku).trim(),String(body.name).trim(),body.description || null,body.unit || 'unité',body.cost || 0,body.salePrice || 0,body.reorderPoint || 0,body.assetAccountId || null,body.expenseAccountId || null,body.revenueAccountId || null,body.trackingMode || 'quantity',body.shelfLifeDays || null,body.expiryWarningDays ?? 30],
    );
    return res.status(201).json({ item: rows[0] });
  } catch (error) { return next(error); }
});

router.get('/locations', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT l.*,COALESCE(SUM(b.quantity),0)::numeric quantity_on_hand,
              COALESCE(SUM(b.inventory_value),0)::numeric inventory_value
       FROM inventory_locations l
       LEFT JOIN inventory_balances b ON b.organisation_id=l.organisation_id AND b.location_id=l.id
       WHERE l.organisation_id=$1 GROUP BY l.id ORDER BY l.name`,
      [req.organisationId],
    );
    return res.json({ locations: rows });
  } catch (error) { return next(error); }
});

router.post('/locations', requireRole('admin'), async (req, res, next) => {
  try {
    if (!String(req.body?.code || '').trim() || !String(req.body?.name || '').trim()) return res.status(400).json({ message: 'Le code et le nom de l’emplacement sont obligatoires.' });
    const { rows } = await req.db.query(
      `INSERT INTO inventory_locations (organisation_id,code,name) VALUES ($1,$2,$3) RETURNING *`,
      [req.organisationId,String(req.body.code).trim(),String(req.body.name).trim()],
    );
    return res.status(201).json({ location: rows[0] });
  } catch (error) { return next(error); }
});

async function postTransaction(req, res, next, type) {
  try {
    const result = await inventoryTransactionService.postInventoryTransaction({
      organisationId: req.organisationId,
      actorUserId: req.user?.id,
      type,
      itemId: req.body.itemId,
      locationId: req.body.locationId,
      destinationLocationId: req.body.destinationLocationId,
      quantity: req.body.quantity,
      unitCost: req.body.unitCost,
      direction: req.body.direction,
      reason: req.body.reason,
      referenceType: req.body.referenceType,
      referenceId: req.body.referenceId,
      idempotencyKey: req.body.idempotencyKey,
      occurredAt: req.body.occurredAt,
    });
    if (!result) return res.status(404).json({ message: 'Article d’inventaire introuvable.' });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
}

router.post('/receipts', requireRole('admin'), (req,res,next) => postTransaction(req,res,next,'receipt'));
router.post('/issues', requireRole('admin'), (req,res,next) => postTransaction(req,res,next,'issue'));
router.post('/adjustments', requireRole('admin'), (req,res,next) => postTransaction(req,res,next,'adjustment'));
router.post('/transfers', requireRole('admin'), (req,res,next) => postTransaction(req,res,next,'transfer'));
router.post('/movements', requireRole('admin'), async (req,res,next) => {
  const type = { receipt:'receipt', issue:'issue', adjustment:'adjustment', transfer:'transfer' }[req.body?.movementType];
  if (!type) return res.status(400).json({ message: 'Utilisez receipt, issue, adjustment ou transfer.' });
  return postTransaction(req,res,next,type);
});

router.get('/balances', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.*,i.sku,i.name item_name,l.code location_code,l.name location_name
       FROM inventory_balances b
       JOIN inventory_items i ON i.id=b.item_id AND i.organisation_id=b.organisation_id
       JOIN inventory_locations l ON l.id=b.location_id AND l.organisation_id=b.organisation_id
       WHERE b.organisation_id=$1
         AND ($2::bigint IS NULL OR b.item_id=$2)
         AND ($3::bigint IS NULL OR b.location_id=$3)
       ORDER BY i.name,l.name`,
      [req.organisationId,req.query.itemId || null,req.query.locationId || null],
    );
    return res.json({ balances: rows });
  } catch (error) { return next(error); }
});

router.get('/transactions', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT t.*,i.sku,i.name item_name,sl.name source_location_name,dl.name destination_location_name
       FROM inventory_transactions t
       JOIN inventory_items i ON i.id=t.item_id AND i.organisation_id=t.organisation_id
       LEFT JOIN inventory_locations sl ON sl.id=t.source_location_id AND sl.organisation_id=t.organisation_id
       LEFT JOIN inventory_locations dl ON dl.id=t.destination_location_id AND dl.organisation_id=t.organisation_id
       WHERE t.organisation_id=$1 AND ($2::bigint IS NULL OR t.item_id=$2)
       ORDER BY t.occurred_at DESC,t.id DESC LIMIT 250`,
      [req.organisationId,req.query.itemId || null],
    );
    return res.json({ transactions: rows });
  } catch (error) { return next(error); }
});

router.get('/valuation', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT COALESCE(SUM(quantity),0)::numeric quantity,
              COALESCE(SUM(inventory_value),0)::numeric inventory_value,
              COUNT(DISTINCT item_id)::integer item_count,
              COUNT(DISTINCT location_id)::integer location_count
       FROM inventory_balances WHERE organisation_id=$1`,
      [req.organisationId],
    );
    return res.json({ valuation: rows[0] });
  } catch (error) { return next(error); }
});

router.get('/alerts', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT i.id,i.sku,i.name,i.reorder_point,
              COALESCE(SUM(b.quantity),0)::numeric quantity_on_hand,
              COALESCE(SUM(b.inventory_value),0)::numeric inventory_value
       FROM inventory_items i
       LEFT JOIN inventory_balances b ON b.organisation_id=i.organisation_id AND b.item_id=i.id
       WHERE i.organisation_id=$1 AND i.is_active=TRUE
       GROUP BY i.id HAVING COALESCE(SUM(b.quantity),0)<=i.reorder_point ORDER BY i.name`,
      [req.organisationId],
    );
    return res.json({ alerts: rows });
  } catch (error) { return next(error); }
});

router.use('/procurement', inventoryProcurementRoutes);
router.use('/traceability', inventoryTraceabilityRoutes);
router.use('/', inventoryControlRoutes);

module.exports = router;
