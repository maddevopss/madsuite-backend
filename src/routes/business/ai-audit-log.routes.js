'use strict';

// Étage 9 PR E — Journal d'audit de l'intelligence (issue #195).
// Lecture seule du journal (écriture uniquement depuis
// src/ai/logAiInvocation.js, appelé par la route de recommandations).

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');

router.use(requireOrganisation);
router.use(requireRole('admin', 'manager'));

router.get('/', async (req, res, next) => {
  try {
    const { useCaseId, incidentId } = req.query;
    const conditions = ['organisation_id=$1'];
    const params = [req.organisationId];
    if (useCaseId) {
      params.push(useCaseId);
      conditions.push(`use_case_id=$${params.length}`);
    }
    if (incidentId) {
      params.push(String(incidentId));
      conditions.push(`correlation->>'objectId'=$${params.length}`);
    }
    const { rows } = await req.db.query(
      `SELECT * FROM ai_audit_log WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      params,
    );
    return res.json({ auditLog: rows });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
