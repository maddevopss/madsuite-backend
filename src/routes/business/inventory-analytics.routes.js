const router = require('express').Router();
const requireRole = require('../../middleware/requireRole');
const service = require('../../services/business/inventory-analytics.service');

router.post('/valuation/snapshots', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await service.createValuationSnapshot(req.db, req.organisationId, req.user?.id, { snapshotDate: req.body.snapshotDate });
    return res.status(201).json(result);
  } catch (error) { return next(error); }
});

router.get('/valuation/history/:date', async (req, res, next) => {
  try {
    const rows = await service.valuationAt(req.db, req.organisationId, req.params.date);
    return res.json({ date: req.params.date, rows });
  } catch (error) { return next(error); }
});

router.get('/valuation/history/:date.csv', async (req, res, next) => {
  try {
    const csv = await service.exportValuationCsv(req.db, req.organisationId, req.params.date);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-valuation-${req.params.date}.csv"`);
    return res.send(csv);
  } catch (error) { return next(error); }
});

router.get('/analytics/movements', async (req, res, next) => {
  try {
    const result = await service.movementAnalytics(req.db, req.organisationId, {
      days: req.query.days,
      itemId: req.query.itemId,
      locationId: req.query.locationId,
    });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.get('/analytics/aging', async (req, res, next) => {
  try {
    const rows = await service.agingReport(req.db, req.organisationId);
    return res.json({ rows });
  } catch (error) { return next(error); }
});

router.get('/replenishment/policies', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT p.*,i.sku,i.name item_name,l.code location_code,s.name supplier_name
       FROM inventory_replenishment_policies p
       JOIN inventory_items i ON i.organisation_id=p.organisation_id AND i.id=p.item_id
       LEFT JOIN inventory_locations l ON l.organisation_id=p.organisation_id AND l.id=p.location_id
       LEFT JOIN suppliers s ON s.organisation_id=p.organisation_id AND s.id=p.preferred_supplier_id
       WHERE p.organisation_id=$1 ORDER BY i.name,l.name NULLS FIRST`, [req.organisationId]);
    return res.json({ policies: rows });
  } catch (error) { return next(error); }
});

router.put('/replenishment/policies', requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const { rows } = await req.db.query(
      `INSERT INTO inventory_replenishment_policies
        (organisation_id,item_id,location_id,lead_time_days,review_period_days,safety_stock,minimum_order_quantity,order_multiple,preferred_supplier_id,is_active,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (organisation_id,item_id,location_id)
       DO UPDATE SET lead_time_days=EXCLUDED.lead_time_days,review_period_days=EXCLUDED.review_period_days,
                     safety_stock=EXCLUDED.safety_stock,minimum_order_quantity=EXCLUDED.minimum_order_quantity,
                     order_multiple=EXCLUDED.order_multiple,preferred_supplier_id=EXCLUDED.preferred_supplier_id,
                     is_active=EXCLUDED.is_active,updated_at=NOW()
       RETURNING *`,
      [req.organisationId,body.itemId,body.locationId || null,body.leadTimeDays ?? 7,body.reviewPeriodDays ?? 7,body.safetyStock ?? 0,body.minimumOrderQuantity ?? 1,body.orderMultiple ?? 1,body.preferredSupplierId || null,body.isActive !== false,req.user?.id || null]);
    return res.json({ policy: rows[0] });
  } catch (error) { return next(error); }
});

router.post('/replenishment/calculate', requireRole('admin'), async (req, res, next) => {
  try {
    const suggestions = await service.calculateSuggestions(req.db, req.organisationId, req.user?.id, { days: req.body.days });
    return res.status(201).json({ suggestions });
  } catch (error) { return next(error); }
});

router.get('/replenishment/suggestions', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT s.*,i.sku,i.name item_name,l.code location_code
       FROM inventory_replenishment_suggestions s
       JOIN inventory_items i ON i.organisation_id=s.organisation_id AND i.id=s.item_id
       LEFT JOIN inventory_locations l ON l.organisation_id=s.organisation_id AND l.id=s.location_id
       WHERE s.organisation_id=$1 AND ($2::varchar IS NULL OR s.status=$2)
       ORDER BY s.stockout_date NULLS LAST,s.calculated_at DESC`, [req.organisationId,req.query.status || null]);
    return res.json({ suggestions: rows });
  } catch (error) { return next(error); }
});

router.post('/replenishment/suggestions/:id/dismiss', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE inventory_replenishment_suggestions SET status='dismissed',explanation=explanation||jsonb_build_object('dismissReason',$3)
       WHERE organisation_id=$1 AND id=$2 AND status='open' RETURNING *`,
      [req.organisationId,req.params.id,req.body.reason || null]);
    if (!rows[0]) return res.status(409).json({ message: 'Suggestion introuvable ou déjà traitée.' });
    return res.json({ suggestion: rows[0] });
  } catch (error) { return next(error); }
});

module.exports = router;
