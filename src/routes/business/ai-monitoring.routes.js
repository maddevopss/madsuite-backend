'use strict';

// Étage 9 PR G — Surveillance des dérives et coûts (issue #195).
// Calcule des métriques réelles à partir du journal d'audit (PR E) —
// jamais un modèle de dérive fabriqué : des seuils déterministes et
// explicables sur des compteurs réels (taux d'acceptation/correction/
// refus, latence moyenne, coût). Le coût est explicitement 0 pour ce cas
// d'usage : le moteur (PR C) est une fonction pure, sans appel LLM
// externe — documenté plutôt que fabriqué. L'arrêt contrôlé réutilise la
// politique de désactivation EXISTANTE de la PR A
// (ai-use-cases.routes.js::deactivateUseCase), pas une réimplémentation.

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const { deactivateUseCase } = require('./ai-use-cases.routes');

router.use(requireOrganisation);
router.use(requireRole('admin', 'manager'));

const MIN_SAMPLE_FOR_DRIFT = 5;
const REFUSAL_RATE_DRIFT_THRESHOLD = 0.5;
const MIN_DECIDED_FOR_ACCEPTANCE_DRIFT = 3;
const ACCEPTANCE_RATE_DRIFT_THRESHOLD = 0.3;

function computeMetrics(entries) {
  const total = entries.length;
  const noRecommendation = entries.filter((e) => e.result_summary?.hasRecommendation === false).length;
  const refusalRate = total ? noRecommendation / total : 0;

  const decided = entries.filter((e) => e.human_decision);
  const confirmed = decided.filter((e) => e.human_decision === 'confirmed').length;
  const declined = decided.filter((e) => e.human_decision === 'declined').length;
  const acceptanceRate = decided.length ? confirmed / decided.length : null;
  const correctionRate = decided.length ? declined / decided.length : null;

  const durations = entries.map((e) => e.duration_ms).filter((d) => Number.isFinite(d));
  const avgDurationMs = durations.length ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length) : null;

  const driftFlags = [];
  if (total >= MIN_SAMPLE_FOR_DRIFT && refusalRate > REFUSAL_RATE_DRIFT_THRESHOLD) {
    driftFlags.push({
      code: 'coverage_drift',
      message: `${(refusalRate * 100).toFixed(0)}% des demandes récentes n'aboutissent à aucune recommandation (seuil : ${(REFUSAL_RATE_DRIFT_THRESHOLD * 100).toFixed(0)}%).`,
    });
  }
  if (decided.length >= MIN_DECIDED_FOR_ACCEPTANCE_DRIFT && acceptanceRate !== null && acceptanceRate < ACCEPTANCE_RATE_DRIFT_THRESHOLD) {
    driftFlags.push({
      code: 'low_acceptance_drift',
      message: `Taux d'acceptation de ${(acceptanceRate * 100).toFixed(0)}% sous le seuil de ${(ACCEPTANCE_RATE_DRIFT_THRESHOLD * 100).toFixed(0)}% — les suggestions semblent peu pertinentes.`,
    });
  }

  return {
    total,
    refusalRate,
    decidedCount: decided.length,
    confirmedCount: confirmed,
    declinedCount: declined,
    pendingCount: total - decided.length,
    acceptanceRate,
    correctionRate,
    avgDurationMs,
    costEstimate: { total: 0, currency: 'CAD', note: "Moteur déterministe sans appel LLM externe pour ce cas d'usage — coût toujours 0." },
    driftFlags,
    recommendedAction: driftFlags.length > 0 ? 'kill_switch_recommended' : 'none',
  };
}

router.get('/:useCaseId/metrics', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      'SELECT human_decision, result_summary, duration_ms FROM ai_audit_log WHERE organisation_id=$1 AND use_case_id=$2 ORDER BY created_at DESC',
      [req.organisationId, req.params.useCaseId],
    );
    return res.json({ useCaseId: req.params.useCaseId, metrics: computeMetrics(rows) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:useCaseId/kill-switch', requireRole('admin'), async (req, res, next) => {
  try {
    if (!String(req.body?.reason || '').trim()) {
      return res.status(400).json({ message: "Le motif de l'arrêt contrôlé est obligatoire." });
    }
    const { activation, alreadyDisabled } = await deactivateUseCase(req.db, {
      organisationId: req.organisationId,
      useCaseId: req.params.useCaseId,
      deactivatedBy: req.user?.id,
      reason: `[surveillance] ${req.body.reason}`,
    });
    return res.json({ activation, alreadyDisabled });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
