const router = require('express').Router();
const requireRole = require('../../middleware/requireRole');
const control = require('../../services/business/inventory-control.service');

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error(`${label} invalide.`), { statusCode: 400 });
  return id;
}

router.get('/availability', async (req, res, next) => {
  try {
    const rows = await control.getAvailability(req.db, req.organisationId, {
      itemId: req.query.itemId || null,
      locationId: req.query.locationId || null,
    });
    return res.json({ availability: rows });
  } catch (error) { return next(error); }
});

router.get('/reservations', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT r.*,i.sku,i.name item_name,l.code location_code,l.name location_name
       FROM inventory_reservations r
       JOIN inventory_items i ON i.organisation_id=r.organisation_id AND i.id=r.item_id
       JOIN inventory_locations l ON l.organisation_id=r.organisation_id AND l.id=r.location_id
       WHERE r.organisation_id=$1
         AND ($2::varchar IS NULL OR r.status=$2)
         AND ($3::bigint IS NULL OR r.item_id=$3)
       ORDER BY r.created_at DESC,r.id DESC LIMIT 500`,
      [req.organisationId,req.query.status || null,req.query.itemId || null],
    );
    return res.json({ reservations: rows });
  } catch (error) { return next(error); }
});

router.post('/reservations', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await control.reserveStock(req.db, req.organisationId, req.user?.id, req.body || {});
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

for (const action of ['release','consume','cancel']) {
  router.post(`/reservations/:id/${action}`, requireRole('admin'), async (req, res, next) => {
    try {
      const result = await control.transitionReservation(req.db, req.organisationId, req.user?.id, positiveId(req.params.id, 'Réservation'), action);
      return res.json(result);
    } catch (error) { return next(error); }
  });
}

router.get('/counts', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT s.*,l.code location_code,l.name location_name,
              COUNT(cl.id)::integer line_count,
              COUNT(cl.id) FILTER (WHERE cl.counted_quantity IS NOT NULL)::integer counted_count,
              COALESCE(SUM(ABS(cl.variance_value)),0)::numeric absolute_variance_value
       FROM inventory_count_sessions s
       JOIN inventory_locations l ON l.organisation_id=s.organisation_id AND l.id=s.location_id
       LEFT JOIN inventory_count_lines cl ON cl.organisation_id=s.organisation_id AND cl.session_id=s.id
       WHERE s.organisation_id=$1
       GROUP BY s.id,l.code,l.name ORDER BY s.created_at DESC`,
      [req.organisationId],
    );
    return res.json({ sessions: rows });
  } catch (error) { return next(error); }
});

router.post('/counts', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await control.createCountSession(req.db, req.organisationId, req.user?.id, req.body || {});
    return res.status(201).json(result);
  } catch (error) { return next(error); }
});

router.get('/counts/:id', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Session');
    const session = await req.db.query(
      `SELECT s.*,l.code location_code,l.name location_name
       FROM inventory_count_sessions s JOIN inventory_locations l
         ON l.organisation_id=s.organisation_id AND l.id=s.location_id
       WHERE s.organisation_id=$1 AND s.id=$2`,
      [req.organisationId,id],
    );
    if (!session.rows[0]) return res.status(404).json({ message: 'Session de comptage introuvable.' });
    const lines = await req.db.query(
      `SELECT cl.*,i.sku,i.name item_name
       FROM inventory_count_lines cl JOIN inventory_items i
         ON i.organisation_id=cl.organisation_id AND i.id=cl.item_id
       WHERE cl.organisation_id=$1 AND cl.session_id=$2 ORDER BY i.name`,
      [req.organisationId,id],
    );
    return res.json({ session: session.rows[0], lines: lines.rows });
  } catch (error) { return next(error); }
});

router.put('/counts/:id/items/:itemId', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await control.recordCount(req.db, req.organisationId, req.user?.id, positiveId(req.params.id, 'Session'), {
      itemId: positiveId(req.params.itemId, 'Article'),
      countedQuantity: req.body?.countedQuantity,
      note: req.body?.note,
    });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.post('/counts/:id/submit', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await control.submitCountSession(req.db, req.organisationId, req.user?.id, positiveId(req.params.id, 'Session'));
    return res.json(result);
  } catch (error) { return next(error); }
});

router.post('/counts/:id/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await control.approveCountSession(req.db, req.organisationId, req.user?.id, positiveId(req.params.id, 'Session'), {
      idempotencyPrefix: req.body?.idempotencyPrefix,
    });
    return res.json(result);
  } catch (error) { return next(error); }
});

module.exports = router;
