'use strict';

// Étage 8 PR G — Revues d'exploitation (issue #194).
// Génère une synthèse hebdomadaire/monthly figée (incidents majeurs,
// changements, dérives de capacité, risques ouverts) à partir des
// données réelles des PR B/D/F et du module risques existant — jamais
// une vue recalculée : une revue doit rester une preuve historique
// stable. Une revue ne se ferme qu'une fois toutes ses décisions
// suivies d'une preuve de suivi (follow_up_evidence).

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');

router.use(requireOrganisation);
router.use(requireRole('admin', 'manager'));

const REVIEW_TYPES = ['weekly', 'monthly'];

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error(`${label} invalide.`), { statusCode: 400 });
  }
  return id;
}

function notFound(message) {
  return Object.assign(new Error(message), { statusCode: 404 });
}

async function buildSynthesis(db, organisationId, start, end) {
  const majorIncidents = (await db.query(
    `SELECT id, service_key, severity, status, declared_at, restored_at
       FROM operational_incidents
      WHERE organisation_id=$1 AND severity IN ('high','critical')
        AND declared_at >= $2 AND declared_at < $3
      ORDER BY declared_at ASC`,
    [organisationId, start, end],
  )).rows;

  const changes = (await db.query(
    `SELECT id, title, risk_level, status, executed_at, rolled_back_at
       FROM operational_changes
      WHERE organisation_id=$1 AND status IN ('executed','rolled_back')
        AND COALESCE(executed_at, rolled_back_at) >= $2 AND COALESCE(executed_at, rolled_back_at) < $3
      ORDER BY COALESCE(executed_at, rolled_back_at) ASC`,
    [organisationId, start, end],
  )).rows;

  // Dérives de capacité : état constaté au moment de la revue (pas
  // limité à la période, une dérive est une situation courante).
  const thresholds = (await db.query(
    `SELECT * FROM operational_capacity_thresholds WHERE organisation_id=$1 AND status='active'`,
    [organisationId],
  )).rows;
  const capacityAlerts = [];
  for (const threshold of thresholds) {
    const latest = (await db.query(
      `SELECT id, quantity, unit, recorded_at FROM operational_capacity_usage
        WHERE organisation_id=$1 AND service_key=$2 AND resource_type=$3
        ORDER BY recorded_at DESC LIMIT 1`,
      [organisationId, threshold.service_key, threshold.resource_type],
    )).rows[0];
    if (!latest) continue;
    const percentUsed = Number(((Number(latest.quantity) / Number(threshold.capacity_limit)) * 100).toFixed(2));
    if (percentUsed >= Number(threshold.warning_threshold_percent)) {
      capacityAlerts.push({ serviceKey: threshold.service_key, resourceType: threshold.resource_type, percentUsed, latestUsageId: latest.id });
    }
  }

  const openRisks = (await db.query(
    `SELECT id, risk_number, category, title, status
       FROM enterprise_risks
      WHERE organisation_id=$1 AND status NOT IN ('closed','cancelled')
      ORDER BY inherent_score DESC`,
    [organisationId],
  )).rows;

  return {
    majorIncidents: majorIncidents.map((i) => ({ id: i.id, serviceKey: i.service_key, severity: i.severity, status: i.status, declaredAt: i.declared_at, restoredAt: i.restored_at })),
    changes: changes.map((c) => ({ id: c.id, title: c.title, riskLevel: c.risk_level, status: c.status, executedAt: c.executed_at, rolledBackAt: c.rolled_back_at })),
    capacityAlerts,
    openRisks: openRisks.map((r) => ({ id: r.id, riskNumber: r.risk_number, category: r.category, title: r.title, status: r.status })),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { reviewType, status } = req.query;
    const conditions = ['organisation_id=$1'];
    const params = [req.organisationId];
    if (reviewType) {
      params.push(reviewType);
      conditions.push(`review_type=$${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status=$${params.length}`);
    }
    const { rows } = await req.db.query(
      `SELECT * FROM operational_reviews WHERE ${conditions.join(' AND ')} ORDER BY period_start DESC`,
      params,
    );
    return res.json({ reviews: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Revue');
    const review = (await req.db.query('SELECT * FROM operational_reviews WHERE id=$1 AND organisation_id=$2', [id, req.organisationId])).rows[0];
    if (!review) throw notFound('Revue introuvable.');
    const decisions = (await req.db.query(
      'SELECT * FROM operational_review_decisions WHERE review_id=$1 AND organisation_id=$2 ORDER BY created_at ASC',
      [id, req.organisationId],
    )).rows;
    return res.json({ review, decisions });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!REVIEW_TYPES.includes(body.reviewType)) return res.status(400).json({ message: 'Type de revue invalide.' });
    const start = body.periodStart ? new Date(body.periodStart) : null;
    const end = body.periodEnd ? new Date(body.periodEnd) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ message: 'La période (periodStart/periodEnd) est invalide.' });
    }

    const summary = await buildSynthesis(req.db, req.organisationId, start.toISOString(), end.toISOString());
    const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
    const { rows } = await req.db.query(
      `INSERT INTO operational_reviews (
         organisation_id, review_type, period_start, period_end, summary, idempotency_key, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organisation_id,idempotency_key)
       DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [req.organisationId, body.reviewType, start.toISOString(), end.toISOString(), JSON.stringify(summary), idempotencyKey, req.user?.id || null],
    );
    return res.status(201).json({ review: rows[0] });
  } catch (error) {
    if (error?.code === '23505' && error?.constraint?.includes('review_type')) {
      return res.status(409).json({ message: 'Une revue existe déjà pour ce type et cette période.' });
    }
    return next(error);
  }
});

router.post('/:id/decisions', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Revue');
    const body = req.body || {};
    const review = (await req.db.query('SELECT * FROM operational_reviews WHERE id=$1 AND organisation_id=$2', [id, req.organisationId])).rows[0];
    if (!review) throw notFound('Revue introuvable.');
    if (review.status !== 'open') return res.status(409).json({ message: 'Une revue fermée ne peut plus recevoir de décision.' });
    if (!String(body.decision || '').trim()) return res.status(400).json({ message: 'La décision est obligatoire.' });
    const responsibleUserId = body.responsibleUserId || req.user?.id;
    if (!responsibleUserId) return res.status(400).json({ message: 'Le responsable est obligatoire.' });

    const { rows } = await req.db.query(
      `INSERT INTO operational_review_decisions (
         organisation_id, review_id, decision, responsible_user_id, due_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.organisationId, id, body.decision, responsibleUserId, body.dueAt || null, req.user?.id || null],
    );
    return res.status(201).json({ decision: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/decisions/:decisionId/complete', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Revue');
    const decisionId = positiveId(req.params.decisionId, 'Décision');
    const body = req.body || {};
    if (!String(body.followUpEvidence || '').trim()) return res.status(400).json({ message: 'La preuve de suivi est obligatoire.' });

    const current = (await req.db.query(
      'SELECT * FROM operational_review_decisions WHERE id=$1 AND review_id=$2 AND organisation_id=$3',
      [decisionId, id, req.organisationId],
    )).rows[0];
    if (!current) throw notFound('Décision introuvable.');
    if (current.status === 'done') return res.status(409).json({ message: 'Cette décision est déjà marquée comme suivie.' });

    const { rows } = await req.db.query(
      `UPDATE operational_review_decisions SET status='done', follow_up_evidence=$4, done_at=NOW()
        WHERE id=$1 AND review_id=$2 AND organisation_id=$3 RETURNING *`,
      [decisionId, id, req.organisationId, body.followUpEvidence],
    );
    return res.json({ decision: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/close', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Revue');
    const review = (await req.db.query('SELECT * FROM operational_reviews WHERE id=$1 AND organisation_id=$2', [id, req.organisationId])).rows[0];
    if (!review) throw notFound('Revue introuvable.');
    if (review.status === 'closed') return res.status(409).json({ message: 'Cette revue est déjà fermée.' });

    const pending = (await req.db.query(
      `SELECT id FROM operational_review_decisions WHERE review_id=$1 AND organisation_id=$2 AND status='pending'`,
      [id, req.organisationId],
    )).rows;
    if (pending.length) {
      return res.status(409).json({
        message: 'Des décisions sont encore sans preuve de suivi.',
        pendingDecisionIds: pending.map((d) => d.id),
      });
    }

    const { rows } = await req.db.query(
      `UPDATE operational_reviews SET status='closed', closed_at=NOW(), closed_by=$3, updated_at=NOW()
        WHERE id=$1 AND organisation_id=$2 RETURNING *`,
      [id, req.organisationId, req.user?.id || null],
    );
    return res.json({ review: rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
