'use strict';

// Étage 8 PR E — Niveaux de service et objectifs (issue #194).
// Définit les objectifs (disponibilité, délai de réponse, délai de
// rétablissement) par service ; les résultats et budgets d'erreur sont
// calculés à la volée depuis les incidents réels (PR B,
// operational_incidents) sur la période demandée — jamais stockés — pour
// qu'un résultat agrégé ne puisse jamais diverger des incidents qui le
// composent. Chaque réponse de résultat/alerte inclut la liste des
// incidents considérés : l'agrégat n'a jamais le droit de masquer les
// incidents réels qui le justifient.

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');

router.use(requireOrganisation);
router.use(requireRole('admin', 'manager'));

function parsePeriod(query) {
  const start = query.periodStart ? new Date(query.periodStart) : null;
  const end = query.periodEnd ? new Date(query.periodEnd) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return null;
  }
  return { start, end };
}

// Calcule disponibilité, délais moyens et budget d'erreur pour un service
// sur une période, à partir des incidents réels qui chevauchent la
// période — jamais d'agrégat stocké séparément des incidents.
async function computeServiceLevelResult(db, organisationId, objective, period) {
  const periodMinutes = (period.end.getTime() - period.start.getTime()) / 60000;

  const { rows: overlapping } = await db.query(
    `SELECT id, severity, declared_at, contained_at, restored_at,
            GREATEST(declared_at, $3::timestamptz) AS effective_start,
            LEAST(COALESCE(restored_at, $4::timestamptz), $4::timestamptz) AS effective_end
       FROM operational_incidents
      WHERE organisation_id=$1 AND service_key=$2
        AND declared_at < $4::timestamptz
        AND (restored_at IS NULL OR restored_at > $3::timestamptz)
      ORDER BY declared_at ASC`,
    [organisationId, objective.service_key, period.start.toISOString(), period.end.toISOString()],
  );

  let downtimeMinutes = 0;
  for (const incident of overlapping) {
    const effectiveEnd = new Date(incident.effective_end).getTime();
    const effectiveStart = new Date(incident.effective_start).getTime();
    if (effectiveEnd > effectiveStart) downtimeMinutes += (effectiveEnd - effectiveStart) / 60000;
  }

  // Délais de réponse/rétablissement calculés uniquement sur les incidents
  // déclarés DANS la période (pas ceux simplement en chevauchement) — évite
  // de compter deux fois un incident déjà mesuré sur une période antérieure.
  const declaredInPeriod = overlapping.filter((incident) => {
    const declaredAt = new Date(incident.declared_at).getTime();
    return declaredAt >= period.start.getTime() && declaredAt < period.end.getTime();
  });
  const withResponseTime = declaredInPeriod.filter((incident) => incident.contained_at);
  const withRestorationTime = declaredInPeriod.filter((incident) => incident.restored_at);
  const avgMinutes = (incidents, fromField, toField) => {
    if (!incidents.length) return null;
    const total = incidents.reduce((sum, incident) => sum + (new Date(incident[toField]) - new Date(incident[fromField])) / 60000, 0);
    return Number((total / incidents.length).toFixed(2));
  };

  const availability = Number((((periodMinutes - downtimeMinutes) / periodMinutes) * 100).toFixed(4));
  const errorBudgetMinutes = Number((periodMinutes * (1 - objective.availability_target / 100)).toFixed(2));
  const errorBudgetConsumedMinutes = Number(downtimeMinutes.toFixed(2));
  const errorBudgetRemainingMinutes = Number((errorBudgetMinutes - errorBudgetConsumedMinutes).toFixed(2));
  const avgResponseTimeMinutes = avgMinutes(withResponseTime, 'declared_at', 'contained_at');
  const avgRestorationTimeMinutes = avgMinutes(withRestorationTime, 'declared_at', 'restored_at');

  return {
    serviceKey: objective.service_key,
    period: { start: period.start.toISOString(), end: period.end.toISOString(), minutes: periodMinutes },
    objective: {
      availabilityTarget: Number(objective.availability_target),
      responseTimeTargetMinutes: objective.response_time_target_minutes,
      restorationTimeTargetMinutes: objective.restoration_time_target_minutes,
    },
    availability,
    availabilityBreached: availability < Number(objective.availability_target),
    avgResponseTimeMinutes,
    responseTimeBreached: avgResponseTimeMinutes !== null && avgResponseTimeMinutes > objective.response_time_target_minutes,
    avgRestorationTimeMinutes,
    restorationTimeBreached: avgRestorationTimeMinutes !== null && avgRestorationTimeMinutes > objective.restoration_time_target_minutes,
    errorBudget: {
      totalMinutes: errorBudgetMinutes,
      consumedMinutes: errorBudgetConsumedMinutes,
      remainingMinutes: errorBudgetRemainingMinutes,
      breached: errorBudgetRemainingMinutes < 0,
    },
    // Jamais masqués : les incidents réels qui composent cet agrégat.
    incidentsConsidered: overlapping.map((incident) => ({
      id: incident.id,
      severity: incident.severity,
      declaredAt: incident.declared_at,
      containedAt: incident.contained_at,
      restoredAt: incident.restored_at,
    })),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { serviceKey } = req.query;
    const conditions = ["organisation_id=$1", "status='active'"];
    const params = [req.organisationId];
    if (serviceKey) {
      params.push(serviceKey);
      conditions.push(`service_key=$${params.length}`);
    }
    const { rows } = await req.db.query(
      `SELECT * FROM operational_slo_objectives WHERE ${conditions.join(' AND ')} ORDER BY service_key ASC`,
      params,
    );
    return res.json({ objectives: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  const client = await req.db.pool.connect();
  try {
    const body = req.body || {};
    if (!String(body.serviceKey || '').trim()) {
      return res.status(400).json({ message: 'Le service concerné est obligatoire.' });
    }
    const availabilityTarget = Number(body.availabilityTarget);
    const responseTimeTargetMinutes = Number(body.responseTimeTargetMinutes);
    const restorationTimeTargetMinutes = Number(body.restorationTimeTargetMinutes);
    if (!(availabilityTarget > 0 && availabilityTarget <= 100)) {
      return res.status(400).json({ message: 'La cible de disponibilité doit être comprise entre 0 exclusif et 100.' });
    }
    if (!(responseTimeTargetMinutes > 0) || !(restorationTimeTargetMinutes > 0)) {
      return res.status(400).json({ message: 'Les délais cibles de réponse et de rétablissement doivent être positifs.' });
    }

    const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
    await client.query('BEGIN');
    await client.query(
      `UPDATE operational_slo_objectives SET status='retired', updated_at=NOW()
        WHERE organisation_id=$1 AND service_key=$2 AND status='active'`,
      [req.organisationId, body.serviceKey],
    );
    const { rows } = await client.query(
      `INSERT INTO operational_slo_objectives (
         organisation_id, service_key, availability_target, response_time_target_minutes,
         restoration_time_target_minutes, idempotency_key, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.organisationId, body.serviceKey, availabilityTarget, responseTimeTargetMinutes, restorationTimeTargetMinutes, idempotencyKey, req.user?.id || null],
    );
    await client.query('COMMIT');
    return res.status(201).json({ objective: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/results', async (req, res, next) => {
  try {
    const { serviceKey } = req.query;
    if (!String(serviceKey || '').trim()) return res.status(400).json({ message: 'Le service concerné est obligatoire.' });
    const period = parsePeriod(req.query);
    if (!period) return res.status(400).json({ message: 'La période (periodStart/periodEnd) est invalide.' });

    const objective = (await req.db.query(
      `SELECT * FROM operational_slo_objectives WHERE organisation_id=$1 AND service_key=$2 AND status='active'`,
      [req.organisationId, serviceKey],
    )).rows[0];
    if (!objective) return res.status(404).json({ message: 'Aucun objectif actif pour ce service.' });

    const result = await computeServiceLevelResult(req.db, req.organisationId, objective, period);
    return res.json({ result });
  } catch (error) {
    return next(error);
  }
});

// Dérive sur budget d'erreur, disponibilité ou délais, tous services
// actifs confondus, sans jamais masquer les incidents qui la composent.
router.get('/alerts', async (req, res, next) => {
  try {
    const period = parsePeriod(req.query) || { start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), end: new Date() };

    const objectives = (await req.db.query(
      `SELECT * FROM operational_slo_objectives WHERE organisation_id=$1 AND status='active' ORDER BY service_key ASC`,
      [req.organisationId],
    )).rows;

    const results = [];
    for (const objective of objectives) {
      const result = await computeServiceLevelResult(req.db, req.organisationId, objective, period);
      if (result.availabilityBreached || result.responseTimeBreached || result.restorationTimeBreached || result.errorBudget.breached) {
        results.push(result);
      }
    }
    return res.json({ alerts: results });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
