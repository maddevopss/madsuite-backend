const router = require('express').Router();
const {
  calculateAvailableQuantity,
  validateReservation,
  calculateCountVariance,
  validateCycleCountApproval,
  validateLotDisposition,
  validateInventoryClosure,
} = require('../../services/business/inventory-complete.service');

const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;

router.get('/reservations', async (req, res, next) => {
  try {
    const { rows } = await req.db.query('SELECT * FROM inventory_reservations WHERE organisation_id=$1 ORDER BY created_at DESC', [req.organisationId]);
    return res.json({ reservations: rows });
  } catch (error) { return next(error); }
});

router.post('/reservations', async (req, res, next) => {
  try {
    const balance = (await req.db.query('SELECT COALESCE(SUM(quantity),0)::numeric quantity_on_hand FROM inventory_balances WHERE organisation_id=$1 AND item_id=$2 AND ($3::bigint IS NULL OR location_id=$3)', [req.organisationId, req.body.itemId, req.body.locationId || null])).rows[0];
    const reserved = (await req.db.query("SELECT COALESCE(SUM(quantity),0)::numeric reserved FROM inventory_reservations WHERE organisation_id=$1 AND item_id=$2 AND status='active' AND ($3::bigint IS NULL OR location_id=$3)", [req.organisationId, req.body.itemId, req.body.locationId || null])).rows[0];
    const availableQuantity = calculateAvailableQuantity({ quantityOnHand: balance.quantity_on_hand, reservedQuantity: reserved.reserved });
    const decision = validateReservation({ quantity: req.body.quantity, availableQuantity, evidence: req.body.evidence || [] });
    if (!decision.allowed) return res.status(400).json(decision);
    const { rows } = await req.db.query(`INSERT INTO inventory_reservations (organisation_id,item_id,location_id,quantity,reference_type,reference_id,expires_at,reason,evidence,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [req.organisationId,req.body.itemId,req.body.locationId||null,req.body.quantity,req.body.referenceType,req.body.referenceId||null,req.body.expiresAt||null,req.body.reason,req.body.evidence||[],key(req),actor(req)]);
    return res.status(201).json({ reservation: rows[0], availableQuantity });
  } catch (error) { return next(error); }
});

router.get('/cycle-counts', async (req, res, next) => {
  try {
    const { rows } = await req.db.query('SELECT * FROM inventory_cycle_counts WHERE organisation_id=$1 ORDER BY created_at DESC', [req.organisationId]);
    return res.json({ cycleCounts: rows });
  } catch (error) { return next(error); }
});

router.post('/cycle-counts/:id/approve', async (req, res, next) => {
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const count = (await client.query('SELECT * FROM inventory_cycle_counts WHERE organisation_id=$1 AND id=$2 FOR UPDATE', [req.organisationId, Number(req.params.id)])).rows[0];
    if (!count) { await client.query('ROLLBACK'); return res.status(404).json({ code: 'inventory.count.not_found' }); }
    const items = (await client.query('SELECT * FROM inventory_cycle_count_items WHERE organisation_id=$1 AND cycle_count_id=$2 ORDER BY id', [req.organisationId, count.id])).rows.map((row) => ({ ...row, expectedQuantity: row.expected_quantity, countedQuantity: row.counted_quantity }));
    const decision = validateCycleCountApproval({ status: count.status, items, evidence: req.body.evidence || [], decisionReason: req.body.decisionReason });
    if (!decision.allowed) { await client.query('ROLLBACK'); return res.status(400).json(decision); }
    const varianceValue = items.reduce((sum, item) => sum + calculateCountVariance({ expectedQuantity: item.expected_quantity, countedQuantity: item.counted_quantity, unitCost: item.unit_cost }).varianceValue, 0);
    const updated = (await client.query("UPDATE inventory_cycle_counts SET status='approved',approved_by=$3,approved_at=NOW(),variance_value=$4,evidence=$5,decision_reason=$6 WHERE organisation_id=$1 AND id=$2 RETURNING *", [req.organisationId,count.id,actor(req),varianceValue,req.body.evidence||[],req.body.decisionReason||null])).rows[0];
    await client.query(`INSERT INTO inventory_status_events (organisation_id,aggregate_type,aggregate_id,from_status,to_status,reason,evidence,created_by) VALUES ($1,'cycle_count',$2,$3,'approved',$4,$5,$6)`, [req.organisationId,count.id,count.status,req.body.decisionReason||null,req.body.evidence||[],actor(req)]);
    await client.query('COMMIT');
    return res.json({ cycleCount: updated });
  } catch (error) { await client.query('ROLLBACK'); return next(error); } finally { client.release(); }
});

router.get('/lots', async (req, res, next) => {
  try {
    const { rows } = await req.db.query('SELECT * FROM inventory_lots WHERE organisation_id=$1 ORDER BY expires_at NULLS LAST,created_at DESC', [req.organisationId]);
    return res.json({ lots: rows });
  } catch (error) { return next(error); }
});

router.post('/lots/:id/disposition', async (req, res, next) => {
  try {
    const current = (await req.db.query('SELECT * FROM inventory_lots WHERE organisation_id=$1 AND id=$2', [req.organisationId, Number(req.params.id)])).rows[0];
    if (!current) return res.status(404).json({ code: 'inventory.lot.not_found' });
    const decision = validateLotDisposition({ status: req.body.status, quantity: current.quantity, reason: req.body.reason, evidence: req.body.evidence || [] });
    if (!decision.allowed) return res.status(400).json(decision);
    const updated = (await req.db.query('UPDATE inventory_lots SET status=$3,evidence=$4 WHERE organisation_id=$1 AND id=$2 RETURNING *', [req.organisationId,current.id,req.body.status,req.body.evidence||[]])).rows[0];
    await req.db.query(`INSERT INTO inventory_status_events (organisation_id,aggregate_type,aggregate_id,from_status,to_status,reason,evidence,created_by) VALUES ($1,'lot',$2,$3,$4,$5,$6,$7)`, [req.organisationId,current.id,current.status,req.body.status,req.body.reason,req.body.evidence||[],actor(req)]);
    return res.json({ lot: updated });
  } catch (error) { return next(error); }
});

router.post('/closure/validate', async (req, res, next) => {
  try {
    const [counts, balances, lots] = await Promise.all([
      req.db.query("SELECT COUNT(*)::integer count FROM inventory_cycle_counts WHERE organisation_id=$1 AND status IN ('submitted','approved')", [req.organisationId]),
      req.db.query('SELECT COUNT(*)::integer count FROM inventory_balances WHERE organisation_id=$1 AND quantity<0', [req.organisationId]),
      req.db.query("SELECT COUNT(*)::integer count FROM inventory_lots WHERE organisation_id=$1 AND expires_at<CURRENT_DATE AND status='available'", [req.organisationId]),
    ]);
    const decision = validateInventoryClosure({ unresolvedCounts: counts.rows[0].count, negativeBalances: balances.rows[0].count, expiredLotsAvailable: lots.rows[0].count, evidence: req.body.evidence || [] });
    return res.status(decision.allowed ? 200 : 409).json(decision);
  } catch (error) { return next(error); }
});

router.get('/complete-alerts', async (req, res, next) => {
  try {
    const [expiredLots, expiringLots, staleReservations, unresolvedCounts] = await Promise.all([
      req.db.query("SELECT * FROM inventory_lots WHERE organisation_id=$1 AND expires_at<CURRENT_DATE AND status='available' ORDER BY expires_at", [req.organisationId]),
      req.db.query("SELECT * FROM inventory_lots WHERE organisation_id=$1 AND expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE+INTERVAL '30 days' AND status='available' ORDER BY expires_at", [req.organisationId]),
      req.db.query("SELECT * FROM inventory_reservations WHERE organisation_id=$1 AND status='active' AND expires_at<NOW() ORDER BY expires_at", [req.organisationId]),
      req.db.query("SELECT * FROM inventory_cycle_counts WHERE organisation_id=$1 AND status IN ('submitted','approved') ORDER BY created_at", [req.organisationId]),
    ]);
    return res.json({ expiredLots: expiredLots.rows, expiringLots: expiringLots.rows, staleReservations: staleReservations.rows, unresolvedCounts: unresolvedCounts.rows });
  } catch (error) { return next(error); }
});

module.exports = router;