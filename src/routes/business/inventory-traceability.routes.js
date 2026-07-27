const router = require('express').Router();
const requireRole = require('../../middleware/requireRole');
const service = require('../../services/business/inventory-traceability.service');

router.get('/lots', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT l.*,i.sku,i.name item_name,s.name supplier_name,
              COALESCE(SUM(b.quantity),0)::numeric quantity_on_hand,
              COALESCE(SUM(b.reserved_quantity),0)::numeric quantity_reserved
       FROM inventory_lots l
       JOIN inventory_items i ON i.organisation_id=l.organisation_id AND i.id=l.item_id
       LEFT JOIN suppliers s ON s.organisation_id=l.organisation_id AND s.id=l.supplier_id
       LEFT JOIN inventory_lot_balances b ON b.organisation_id=l.organisation_id AND b.lot_id=l.id
       WHERE l.organisation_id=$1
         AND ($2::bigint IS NULL OR l.item_id=$2)
         AND ($3::varchar IS NULL OR l.status=$3)
       GROUP BY l.id,i.sku,i.name,s.name
       ORDER BY l.expires_at NULLS LAST,l.id DESC`,
      [req.organisationId,req.query.itemId || null,req.query.status || null],
    );
    return res.json({ lots: rows });
  } catch (error) { return next(error); }
});

router.get('/serials', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT s.*,i.sku,i.name item_name,l.lot_number,loc.code location_code,loc.name location_name
       FROM inventory_serial_numbers s
       JOIN inventory_items i ON i.organisation_id=s.organisation_id AND i.id=s.item_id
       LEFT JOIN inventory_lots l ON l.organisation_id=s.organisation_id AND l.id=s.lot_id
       LEFT JOIN inventory_locations loc ON loc.organisation_id=s.organisation_id AND loc.id=s.location_id
       WHERE s.organisation_id=$1
         AND ($2::bigint IS NULL OR s.item_id=$2)
         AND ($3::varchar IS NULL OR s.status=$3)
         AND ($4::varchar IS NULL OR s.serial_number ILIKE '%'||$4||'%')
       ORDER BY s.created_at DESC,s.id DESC LIMIT 500`,
      [req.organisationId,req.query.itemId || null,req.query.status || null,req.query.search || null],
    );
    return res.json({ serials: rows });
  } catch (error) { return next(error); }
});

router.post('/tracked-receipts', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await service.receiveTrackedStock({
      organisationId: req.organisationId,
      actorUserId: req.user?.id,
      ...req.body,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.post('/tracked-issues', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await service.issueTrackedStock({
      organisationId: req.organisationId,
      actorUserId: req.user?.id,
      ...req.body,
    });
    return res.status(201).json(result);
  } catch (error) { return next(error); }
});

router.post('/lots/:lotId/:action', requireRole('admin'), async (req, res, next) => {
  try {
    if (!['quarantine','release','recall'].includes(req.params.action)) return res.status(400).json({ message: 'Action de lot invalide.' });
    const result = await service.changeLotStatus({
      organisationId: req.organisationId,
      actorUserId: req.user?.id,
      lotId: req.params.lotId,
      action: req.params.action,
      itemId: req.body.itemId,
      reason: req.body.reason,
      idempotencyKey: req.body.idempotencyKey,
      referenceType: req.body.referenceType || 'inventory_lot',
      referenceId: req.body.referenceId || String(req.params.lotId),
      locationId: req.body.locationId,
    });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.get('/expiry-alerts', async (req, res, next) => {
  try {
    const alerts = await service.listExpiryAlerts(req.db, req.organisationId, { days: req.query.days });
    return res.json({ alerts });
  } catch (error) { return next(error); }
});

router.get('/trace', async (req, res, next) => {
  try {
    const events = await service.traceItem(req.db, req.organisationId, {
      itemId: req.query.itemId,
      lotId: req.query.lotId,
      serialNumber: req.query.serialNumber,
    });
    return res.json({ events });
  } catch (error) { return next(error); }
});

router.get('/recalls', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT r.*,i.sku,i.name item_name,l.lot_number
       FROM inventory_recalls r
       JOIN inventory_items i ON i.organisation_id=r.organisation_id AND i.id=r.item_id
       LEFT JOIN inventory_lots l ON l.organisation_id=r.organisation_id AND l.id=r.lot_id
       WHERE r.organisation_id=$1 AND ($2::varchar IS NULL OR r.status=$2)
       ORDER BY r.opened_at DESC,r.id DESC`,
      [req.organisationId,req.query.status || null],
    );
    return res.json({ recalls: rows });
  } catch (error) { return next(error); }
});

router.post('/recalls', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await service.openRecall({ organisationId: req.organisationId, actorUserId: req.user?.id, ...req.body });
    return res.status(201).json(result);
  } catch (error) { return next(error); }
});

router.post('/recalls/:id/close', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE inventory_recalls SET status='closed',closed_at=NOW(),notes=COALESCE($3,notes)
       WHERE organisation_id=$1 AND id=$2 AND status IN ('open','contained') RETURNING *`,
      [req.organisationId,req.params.id,req.body.notes || null],
    );
    if (!rows[0]) return res.status(409).json({ message: 'Rappel introuvable ou déjà fermé.' });
    return res.json({ recall: rows[0] });
  } catch (error) { return next(error); }
});

module.exports = router;
