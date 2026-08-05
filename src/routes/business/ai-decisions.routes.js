'use strict';

// Étage 9 PR D — Confirmation humaine et exécution (issue #195).
// Sépare strictement : génération (PR C, déjà journalisée par la PR E
// dans ai_audit_log), validation humaine (confirm/decline ci-dessous,
// réservée admin), exécution (uniquement sur confirmation, en appelant
// la politique métier EXISTANTE — operational-problems.routes.js::
// linkIncidentToProblem — jamais une réimplémentation). L'auteur humain
// de la décision finale est conservé sur la MÊME ligne d'audit
// (human_decision/human_decision_by/human_decision_at), pas une table
// séparée qui pourrait diverger de ce qui a réellement été montré.

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const { linkIncidentToProblem } = require('./operational-problems.routes');

router.use(requireOrganisation);
router.use(requireRole('admin'));

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

async function loadUndecidedAuditEntry(req, auditEntryId) {
  const entry = (await req.db.query(
    'SELECT * FROM ai_audit_log WHERE id=$1 AND organisation_id=$2',
    [auditEntryId, req.organisationId],
  )).rows[0];
  if (!entry) throw notFound("Ligne d'audit introuvable.");
  if (entry.human_decision) {
    throw Object.assign(new Error('Cette recommandation a déjà fait l\'objet d\'une décision.'), { statusCode: 409, code: 'ai.decision_already_made' });
  }
  if (!entry.result_summary?.hasRecommendation) {
    throw Object.assign(new Error("Aucune recommandation n'a été générée pour cette ligne — rien à confirmer ou refuser."), { statusCode: 409, code: 'ai.no_recommendation_to_decide' });
  }
  return entry;
}

router.post('/:auditEntryId/confirm', async (req, res, next) => {
  try {
    const auditEntryId = positiveId(req.params.auditEntryId, "Ligne d'audit");
    const entry = await loadUndecidedAuditEntry(req, auditEntryId);

    const problemId = Number(req.body?.problemId);
    const authorizedIds = (entry.authorized_context_summary?.knownErrorIds || []).map(Number);
    if (!Number.isInteger(problemId) || !authorizedIds.includes(problemId)) {
      return res.status(400).json({
        message: "Le problème confirmé doit figurer parmi les erreurs connues effectivement citées par la recommandation.",
        code: 'ai.problem_not_in_recommendation',
      });
    }

    // Exécution : applique la politique métier EXISTANTE (Étage 8 PR C),
    // pas une réimplémentation.
    const execution = await linkIncidentToProblem(req.db, {
      organisationId: req.organisationId,
      problemId,
      incidentId: Number(entry.correlation.objectId),
    });

    const { rows } = await req.db.query(
      `UPDATE ai_audit_log SET human_decision='confirmed', human_decision_by=$3, human_decision_at=NOW()
        WHERE id=$1 AND organisation_id=$2 RETURNING *`,
      [auditEntryId, req.organisationId, req.user?.id || null],
    );
    return res.json({ auditEntry: rows[0], execution });
  } catch (error) {
    if (error.code === 'ai.decision_already_made' || error.code === 'ai.no_recommendation_to_decide') {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    return next(error);
  }
});

router.post('/:auditEntryId/decline', async (req, res, next) => {
  try {
    const auditEntryId = positiveId(req.params.auditEntryId, "Ligne d'audit");
    await loadUndecidedAuditEntry(req, auditEntryId);
    if (!String(req.body?.reason || '').trim()) {
      return res.status(400).json({ message: 'Le motif de refus est obligatoire.' });
    }

    const { rows } = await req.db.query(
      `UPDATE ai_audit_log SET human_decision='declined', human_decision_by=$3, human_decision_at=NOW()
        WHERE id=$1 AND organisation_id=$2 RETURNING *`,
      [auditEntryId, req.organisationId, req.user?.id || null],
    );
    return res.json({ auditEntry: rows[0] });
  } catch (error) {
    if (error.code === 'ai.decision_already_made' || error.code === 'ai.no_recommendation_to_decide') {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    return next(error);
  }
});

module.exports = router;
