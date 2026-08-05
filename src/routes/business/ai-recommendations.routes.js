'use strict';

// Étage 9 PR C — Recommandations et explications (issue #195).
// Assemble le contexte contrôlé (PR B) puis génère la recommandation
// structurée (src/ai/generateIncidentRecommendation.js). Même garde
// d'activation que la PR B : rien n'est généré pour une organisation qui
// n'a pas explicitement activé le cas d'usage.
// Étage 9 PR E — chaque génération réelle (donc jamais un 403 d'activation,
// où rien n'a été traité) est journalée (src/ai/logAiInvocation.js).
// Étage 9 PR G — la latence réelle de génération est mesurée ici et
// transmise au journal pour la surveillance des dérives et coûts.

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const { assembleIncidentKnownErrorContext } = require('../../ai/assembleIncidentKnownErrorContext');
const { generateIncidentRecommendation } = require('../../ai/generateIncidentRecommendation');
const { logAiInvocation } = require('../../ai/logAiInvocation');

router.use(requireOrganisation);
router.use(requireRole('admin', 'manager'));

async function requireActiveUseCase(req, useCaseId) {
  const activation = (await req.db.query(
    "SELECT * FROM ai_use_case_activations WHERE organisation_id=$1 AND use_case_id=$2 AND status='active'",
    [req.organisationId, useCaseId],
  )).rows[0];
  if (!activation) {
    throw Object.assign(new Error(`Le cas d'usage '${useCaseId}' n'est pas activé pour cette organisation.`), {
      statusCode: 403,
      code: 'ai.use_case_not_activated',
    });
  }
  return activation;
}

router.get('/incident-known-error-suggestion/:incidentId', async (req, res, next) => {
  try {
    const startedAt = Date.now();
    const activation = await requireActiveUseCase(req, 'incident-known-error-suggestion');
    const context = await assembleIncidentKnownErrorContext(req.db, {
      organisationId: req.organisationId,
      incidentId: req.params.incidentId,
    });
    const { recommendation, reason } = generateIncidentRecommendation(context);
    const auditEntry = await logAiInvocation(req.db, {
      organisationId: req.organisationId,
      useCaseId: 'incident-known-error-suggestion',
      useCaseVersion: activation.use_case_version,
      requestedBy: req.user?.id,
      context,
      recommendation,
      reason,
      durationMs: Date.now() - startedAt,
    });
    // Le contexte est toujours renvoyé, même sans recommandation : jamais
    // masquer les données qui ont mené (ou non) à la suggestion.
    return res.json({ context, recommendation, reason: recommendation ? undefined : reason, auditEntryId: auditEntry.id });
  } catch (error) {
    if (error.code === 'ai.use_case_not_activated') return res.status(403).json({ message: error.message, code: error.code });
    return next(error);
  }
});

module.exports = router;
