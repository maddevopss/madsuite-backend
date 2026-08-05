'use strict';

// Étage 8 PR C — Problèmes et causes profondes (issue #194).
// Sépare l'incident ponctuel (PR B, operational_incidents) du problème
// récurrent : un problème regroupe un ou plusieurs incidents liés,
// traverse une analyse de cause puis une action corrective, et n'est
// fermé qu'après vérification. Une récidive sur un problème déjà résolu
// le rouvre automatiquement (le correctif n'a pas tenu) ; une fermeture
// sans élimination complète de la cause devient une erreur connue
// documentée (workaround), consultable via /known-errors.

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const { checkBlockClosure } = require('../../utils/blockClosureValidation');

router.use(requireOrganisation);
router.use(requireRole('admin', 'manager'));

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

// Un incident_id valide pour un autre tenant ne doit pas pouvoir être lié.
async function assertIncidentInOrg(db, incidentId, organisationId) {
  const incident = (await db.query(
    'SELECT id FROM operational_incidents WHERE id=$1 AND organisation_id=$2',
    [incidentId, organisationId],
  )).rows[0];
  if (!incident) throw notFound('Incident introuvable.');
}

router.get('/', async (req, res, next) => {
  try {
    const { status, closureType } = req.query;
    const conditions = ['organisation_id=$1'];
    const params = [req.organisationId];
    if (status) {
      params.push(status);
      conditions.push(`status=$${params.length}`);
    }
    if (closureType) {
      params.push(closureType);
      conditions.push(`closure_type=$${params.length}`);
    }
    const { rows } = await req.db.query(
      `SELECT * FROM operational_problems WHERE ${conditions.join(' AND ')} ORDER BY opened_at DESC`,
      params,
    );
    return res.json({ problems: rows });
  } catch (error) {
    return next(error);
  }
});

// Registre des erreurs connues : problèmes fermés sans élimination
// complète de la cause, avec contournement documenté.
router.get('/known-errors', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM operational_problems
        WHERE organisation_id=$1 AND status='closed' AND closure_type='known_error'
        ORDER BY closed_at DESC`,
      [req.organisationId],
    );
    return res.json({ knownErrors: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!String(body.title || '').trim() || !String(body.description || '').trim()) {
      return res.status(400).json({ message: 'Le titre et la description sont obligatoires.' });
    }
    const responsibleUserId = body.responsibleUserId || req.user?.id;
    if (!responsibleUserId) {
      return res.status(400).json({ message: 'Le responsable est obligatoire.' });
    }
    const linkedIncidentIds = Array.isArray(body.linkedIncidentIds) ? body.linkedIncidentIds : [];
    for (const incidentId of linkedIncidentIds) {
      await assertIncidentInOrg(req.db, incidentId, req.organisationId);
    }

    const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
    const { rows } = await req.db.query(
      `INSERT INTO operational_problems (
         organisation_id, problem_number, title, description, category,
         responsible_user_id, linked_incident_ids, recurrence_count,
         last_recurrence_at, evidence, idempotency_key, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (organisation_id,idempotency_key)
       DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [
        req.organisationId,
        body.problemNumber || `PRB-${Date.now()}`,
        body.title,
        body.description,
        body.category || null,
        responsibleUserId,
        JSON.stringify(linkedIncidentIds),
        linkedIncidentIds.length,
        linkedIncidentIds.length ? new Date() : null,
        JSON.stringify(body.evidence || []),
        idempotencyKey,
        req.user?.id || null,
      ],
    );
    return res.status(201).json({ problem: rows[0] });
  } catch (error) {
    return next(error);
  }
});

// Lier un nouvel incident à un problème existant : preuve de récidive.
// Si le problème était déjà "resolved"/"closed" (correctif jugé effectif),
// la récidive le rouvre automatiquement à 'open' ; s'il était fermé comme
// erreur connue, la récidive est attendue et n'entraîne pas de réouverture.
router.post('/:id/link-incident', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Problème');
    const incidentId = positiveId(req.body?.incidentId, 'Incident');
    await assertIncidentInOrg(req.db, incidentId, req.organisationId);

    const current = (await req.db.query(
      'SELECT * FROM operational_problems WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
      [id, req.organisationId],
    )).rows[0];
    if (!current) throw notFound('Problème introuvable.');

    const alreadyLinked = (current.linked_incident_ids || []).map(Number).includes(incidentId);
    if (alreadyLinked) {
      return res.status(200).json({ problem: current, duplicate: true });
    }

    const wasClosedAsResolved = current.status === 'closed' && current.closure_type === 'resolved';
    const nextStatus = wasClosedAsResolved ? 'open' : current.status;
    const nextLinked = [...(current.linked_incident_ids || []), incidentId];

    const { rows } = await req.db.query(
      `UPDATE operational_problems
          SET linked_incident_ids=$3::jsonb,
              recurrence_count=recurrence_count+1,
              last_recurrence_at=NOW(),
              status=$4,
              closed_at=CASE WHEN $4='open' THEN NULL ELSE closed_at END,
              closure_type=CASE WHEN $4='open' THEN NULL ELSE closure_type END,
              updated_at=NOW()
        WHERE organisation_id=$1 AND id=$2
        RETURNING *`,
      [req.organisationId, id, JSON.stringify(nextLinked), nextStatus],
    );
    return res.json({ problem: rows[0], reopened: wasClosedAsResolved });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/:action', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Problème');
    const action = req.params.action;
    const body = req.body || {};

    const current = (await req.db.query(
      'SELECT * FROM operational_problems WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
      [id, req.organisationId],
    )).rows[0];
    if (!current) throw notFound('Problème introuvable.');
    checkBlockClosure(current, { finalStates: ['closed'] });

    if (action === 'analyze') {
      if (current.status !== 'open') return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
      if (!String(body.rootCause || '').trim()) return res.status(400).json({ message: "L'analyse de cause est obligatoire." });
      const { rows } = await req.db.query(
        `UPDATE operational_problems SET status='root_cause_identified', root_cause=$3,
            evidence=CASE WHEN $4::jsonb='[]'::jsonb THEN evidence ELSE evidence || $4::jsonb END,
            updated_at=NOW()
          WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [req.organisationId, id, body.rootCause, JSON.stringify(body.evidence || [])],
      );
      return res.json({ problem: rows[0] });
    }

    if (action === 'remediate') {
      if (current.status !== 'root_cause_identified' && current.status !== 'corrective_action_in_progress') {
        return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
      }
      if (!String(body.correctiveAction || '').trim()) return res.status(400).json({ message: "L'action corrective est obligatoire." });
      const ownerUserId = body.ownerUserId || req.user?.id;
      const { rows } = await req.db.query(
        `UPDATE operational_problems SET status='corrective_action_in_progress', corrective_action=$3,
            corrective_action_owner_id=$4, corrective_action_due_at=$5, verification_outcome=NULL,
            updated_at=NOW()
          WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [req.organisationId, id, body.correctiveAction, ownerUserId, body.dueAt || null],
      );
      return res.json({ problem: rows[0] });
    }

    if (action === 'verify') {
      if (current.status !== 'corrective_action_in_progress') {
        return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
      }
      if (!['effective', 'ineffective'].includes(body.outcome)) {
        return res.status(400).json({ message: "Le résultat de vérification ('effective' ou 'ineffective') est obligatoire." });
      }
      if (!String(body.verificationEvidence || '').trim()) {
        return res.status(400).json({ message: 'La preuve de vérification est obligatoire.' });
      }
      const nextStatus = body.outcome === 'effective' ? 'resolved' : 'corrective_action_in_progress';
      const { rows } = await req.db.query(
        `UPDATE operational_problems SET status=$3, verification_outcome=$4,
            evidence=evidence || $5::jsonb, updated_at=NOW()
          WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [req.organisationId, id, nextStatus, body.outcome, JSON.stringify([{ verificationEvidence: body.verificationEvidence, at: new Date().toISOString() }])],
      );
      return res.json({ problem: rows[0] });
    }

    if (action === 'close') {
      if (!['resolved', 'known_error'].includes(body.closureType)) {
        return res.status(400).json({ message: "Le type de fermeture ('resolved' ou 'known_error') est obligatoire." });
      }
      if (body.closureType === 'resolved' && current.status !== 'resolved') {
        return res.status(409).json({ message: "Un problème ne peut être fermé 'resolved' qu'après vérification effective." });
      }
      if (!['resolved', 'corrective_action_in_progress', 'root_cause_identified'].includes(current.status)) {
        return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
      }
      if (body.closureType === 'known_error' && !String(body.workaround || '').trim()) {
        return res.status(400).json({ message: 'Le contournement documenté est obligatoire pour une erreur connue.' });
      }
      const { rows } = await req.db.query(
        `UPDATE operational_problems SET status='closed', closure_type=$3, workaround=$4,
            closed_at=NOW(), updated_at=NOW()
          WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [req.organisationId, id, body.closureType, body.workaround || null],
      );
      return res.json({ problem: rows[0] });
    }

    return res.status(404).json({ message: 'Action inconnue.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
