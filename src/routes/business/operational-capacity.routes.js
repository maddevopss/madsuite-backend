'use strict';

// Étage 8 PR F — Coûts et capacité (issue #194).
// Suit la consommation opérationnelle (stockage, traitements,
// fournisseurs) en unités physiques uniquement — aucun champ de
// coût/montant dans ce module : le rattachement financier appartient au
// module comptabilité / gestion financière avancée, jamais à
// l'exploitation, pour éviter toute double comptabilisation. Les
// prévisions de capacité sont calculées à la volée par régression
// linéaire sur les relevés réels, jamais mémorisées séparément.

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');

router.use(requireOrganisation);
router.use(requireRole('admin', 'manager'));

const RESOURCE_TYPES = ['storage', 'compute', 'supplier', 'other'];

function linearRegression(points) {
  const n = points.length;
  const xMean = points.reduce((sum, p) => sum + p.x, 0) / n;
  const yMean = points.reduce((sum, p) => sum + p.y, 0) / n;
  const numerator = points.reduce((sum, p) => sum + (p.x - xMean) * (p.y - yMean), 0);
  const denominator = points.reduce((sum, p) => sum + (p.x - xMean) ** 2, 0);
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

router.get('/usage', async (req, res, next) => {
  try {
    const { serviceKey, resourceType } = req.query;
    const conditions = ['organisation_id=$1'];
    const params = [req.organisationId];
    if (serviceKey) {
      params.push(serviceKey);
      conditions.push(`service_key=$${params.length}`);
    }
    if (resourceType) {
      params.push(resourceType);
      conditions.push(`resource_type=$${params.length}`);
    }
    const { rows } = await req.db.query(
      `SELECT * FROM operational_capacity_usage WHERE ${conditions.join(' AND ')} ORDER BY recorded_at DESC`,
      params,
    );
    return res.json({ usage: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/usage', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!String(body.serviceKey || '').trim()) return res.status(400).json({ message: 'Le service concerné est obligatoire.' });
    if (!RESOURCE_TYPES.includes(body.resourceType)) return res.status(400).json({ message: 'Type de ressource invalide.' });
    if (!String(body.unit || '').trim()) return res.status(400).json({ message: "L'unité de mesure est obligatoire." });
    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) return res.status(400).json({ message: 'La quantité doit être un nombre positif ou nul.' });
    if (body.resourceType === 'supplier' && !String(body.supplierKey || '').trim()) {
      return res.status(400).json({ message: 'Le fournisseur concerné est obligatoire pour une ressource de type "supplier".' });
    }

    const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
    const { rows } = await req.db.query(
      `INSERT INTO operational_capacity_usage (
         organisation_id, service_key, resource_type, supplier_key, unit, quantity,
         recorded_at, evidence, idempotency_key, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,NOW()),$8,$9,$10)
       ON CONFLICT (organisation_id,idempotency_key)
       DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [
        req.organisationId,
        body.serviceKey,
        body.resourceType,
        body.supplierKey || null,
        body.unit,
        quantity,
        body.recordedAt || null,
        JSON.stringify(body.evidence || []),
        idempotencyKey,
        req.user?.id || null,
      ],
    );
    return res.status(201).json({ usage: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/thresholds', async (req, res, next) => {
  try {
    const { serviceKey, resourceType } = req.query;
    const conditions = ["organisation_id=$1", "status='active'"];
    const params = [req.organisationId];
    if (serviceKey) {
      params.push(serviceKey);
      conditions.push(`service_key=$${params.length}`);
    }
    if (resourceType) {
      params.push(resourceType);
      conditions.push(`resource_type=$${params.length}`);
    }
    const { rows } = await req.db.query(
      `SELECT * FROM operational_capacity_thresholds WHERE ${conditions.join(' AND ')} ORDER BY service_key ASC`,
      params,
    );
    return res.json({ thresholds: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/thresholds', async (req, res, next) => {
  const client = await req.db.pool.connect();
  try {
    const body = req.body || {};
    if (!String(body.serviceKey || '').trim()) return res.status(400).json({ message: 'Le service concerné est obligatoire.' });
    if (!RESOURCE_TYPES.includes(body.resourceType)) return res.status(400).json({ message: 'Type de ressource invalide.' });
    const capacityLimit = Number(body.capacityLimit);
    if (!Number.isFinite(capacityLimit) || capacityLimit <= 0) return res.status(400).json({ message: 'La limite de capacité doit être positive.' });
    const warningThresholdPercent = body.warningThresholdPercent === undefined ? 80 : Number(body.warningThresholdPercent);
    if (!(warningThresholdPercent > 0 && warningThresholdPercent <= 100)) {
      return res.status(400).json({ message: "Le seuil d'alerte doit être compris entre 0 exclusif et 100." });
    }

    const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
    await client.query('BEGIN');
    await client.query(
      `UPDATE operational_capacity_thresholds SET status='retired', updated_at=NOW()
        WHERE organisation_id=$1 AND service_key=$2 AND resource_type=$3 AND status='active'`,
      [req.organisationId, body.serviceKey, body.resourceType],
    );
    const { rows } = await client.query(
      `INSERT INTO operational_capacity_thresholds (
         organisation_id, service_key, resource_type, capacity_limit, warning_threshold_percent, idempotency_key, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.organisationId, body.serviceKey, body.resourceType, capacityLimit, warningThresholdPercent, idempotencyKey, req.user?.id || null],
    );
    await client.query('COMMIT');
    return res.status(201).json({ threshold: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

// Prévision de capacité par régression linéaire sur les relevés réels
// (jamais mémorisée séparément — recalculée à chaque appel).
router.get('/forecast', async (req, res, next) => {
  try {
    const { serviceKey, resourceType } = req.query;
    if (!String(serviceKey || '').trim() || !RESOURCE_TYPES.includes(resourceType)) {
      return res.status(400).json({ message: 'Le service et le type de ressource sont obligatoires.' });
    }
    const lookbackDays = Number(req.query.lookbackDays) || 90;

    const { rows } = await req.db.query(
      `SELECT quantity, recorded_at FROM operational_capacity_usage
        WHERE organisation_id=$1 AND service_key=$2 AND resource_type=$3
          AND recorded_at >= NOW() - ($4 || ' days')::interval
        ORDER BY recorded_at ASC`,
      [req.organisationId, serviceKey, resourceType, lookbackDays],
    );

    if (rows.length < 2) {
      return res.json({ forecast: null, reason: 'insufficient_data', dataPoints: rows.length });
    }

    const firstAt = new Date(rows[0].recorded_at).getTime();
    const points = rows.map((row) => ({ x: (new Date(row.recorded_at).getTime() - firstAt) / 1000, y: Number(row.quantity) }));
    const { slope } = linearRegression(points);
    const dailyRate = slope * 86400;
    const currentQuantity = Number(rows[rows.length - 1].quantity);

    const threshold = (await req.db.query(
      `SELECT capacity_limit FROM operational_capacity_thresholds
        WHERE organisation_id=$1 AND service_key=$2 AND resource_type=$3 AND status='active'`,
      [req.organisationId, serviceKey, resourceType],
    )).rows[0];

    let daysUntilBreach = null;
    let projectedBreachAt = null;
    if (threshold) {
      if (currentQuantity >= Number(threshold.capacity_limit)) {
        daysUntilBreach = 0;
      } else if (dailyRate > 0) {
        daysUntilBreach = Number(((Number(threshold.capacity_limit) - currentQuantity) / dailyRate).toFixed(2));
        projectedBreachAt = new Date(Date.now() + daysUntilBreach * 86400 * 1000).toISOString();
      }
    }

    return res.json({
      forecast: {
        serviceKey,
        resourceType,
        dataPoints: rows.length,
        currentQuantity,
        dailyGrowthRate: Number(dailyRate.toFixed(4)),
        capacityLimit: threshold ? Number(threshold.capacity_limit) : null,
        daysUntilBreach,
        projectedBreachAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

// Dérive sur seuil de capacité, tous services/ressources actifs
// confondus — jamais sans le relevé réel qui la justifie.
router.get('/alerts', async (req, res, next) => {
  try {
    const thresholds = (await req.db.query(
      `SELECT * FROM operational_capacity_thresholds WHERE organisation_id=$1 AND status='active'`,
      [req.organisationId],
    )).rows;

    const alerts = [];
    for (const threshold of thresholds) {
      const latest = (await req.db.query(
        `SELECT * FROM operational_capacity_usage
          WHERE organisation_id=$1 AND service_key=$2 AND resource_type=$3
          ORDER BY recorded_at DESC LIMIT 1`,
        [req.organisationId, threshold.service_key, threshold.resource_type],
      )).rows[0];
      if (!latest) continue;
      const percentUsed = Number(((Number(latest.quantity) / Number(threshold.capacity_limit)) * 100).toFixed(2));
      if (percentUsed >= Number(threshold.warning_threshold_percent)) {
        alerts.push({
          serviceKey: threshold.service_key,
          resourceType: threshold.resource_type,
          capacityLimit: Number(threshold.capacity_limit),
          warningThresholdPercent: Number(threshold.warning_threshold_percent),
          percentUsed,
          breached: percentUsed >= 100,
          latestUsage: { id: latest.id, quantity: Number(latest.quantity), unit: latest.unit, recordedAt: latest.recorded_at },
        });
      }
    }
    return res.json({ alerts });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
