'use strict';

// Étage 9 PR B — Contexte institutionnel contrôlé (issue #195).
// Expose l'assemblage de contexte (src/ai/assembleIncidentKnownErrorContext.js)
// derrière la garde d'activation de la PR A : un contexte n'est JAMAIS
// assemblé pour une organisation qui n'a pas explicitement activé le cas
// d'usage — même en lecture seule, même pour un simple aperçu.

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const { assembleIncidentKnownErrorContext } = require('../../ai/assembleIncidentKnownErrorContext');

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
    await requireActiveUseCase(req, 'incident-known-error-suggestion');
    const context = await assembleIncidentKnownErrorContext(req.db, {
      organisationId: req.organisationId,
      incidentId: req.params.incidentId,
    });
    return res.json({ context });
  } catch (error) {
    if (error.code === 'ai.use_case_not_activated') return res.status(403).json({ message: error.message, code: error.code });
    return next(error);
  }
});

module.exports = router;
