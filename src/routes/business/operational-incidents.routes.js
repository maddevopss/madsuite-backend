'use strict';

// Étage 8 PR B — Incidents opérationnels (issue #194).
// Cycle de vie explicite déclaré → contenu → rétabli → fermé (ordre
// strict, pas de saut d'étape) : preuve de rétablissement et cause
// provisoire obligatoires avant de marquer un incident rétabli, résumé de
// clôture obligatoire avant de le fermer. `service_key` référence
// librement l'identifiant d'un service du registre (PR A,
// src/operations/serviceRegistry.js) sans contrainte FK — ce registre est
// un module pur en mémoire, sans persistance (constat de l'Étage 8 PR A).

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const { checkBlockClosure } = require('../../utils/blockClosureValidation');

router.use(requireOrganisation);
// Déclaration/consultation/transitions : réservées admin/manager, comme le
// reste des blocs métier sensibles (paie, risques, résilience).
router.use(requireRole('admin', 'manager'));

const SEVERITIES = ['low', 'medium', 'high', 'critical'];

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

router.get('/', async (req, res, next) => {
  try {
    const { status, severity } = req.query;
    const conditions = ['organisation_id=$1'];
    const params = [req.organisationId];
    if (status) {
      params.push(status);
      conditions.push(`status=$${params.length}`);
    }
    if (severity) {
      params.push(severity);
      conditions.push(`severity=$${params.length}`);
    }
    const { rows } = await req.db.query(
      `SELECT * FROM operational_incidents WHERE ${conditions.join(' AND ')} ORDER BY declared_at DESC`,
      params,
    );
    return res.json({ incidents: rows });
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
    if (!SEVERITIES.includes(body.severity)) {
      return res.status(400).json({ message: 'Gravité invalide.' });
    }
    if (!String(body.impactSummary || '').trim()) {
      return res.status(400).json({ message: "Le résumé d'impact est obligatoire." });
    }
    if (!String(body.serviceKey || '').trim()) {
      return res.status(400).json({ message: 'Le service concerné est obligatoire.' });
    }
    const responsibleUserId = body.responsibleUserId || req.user?.id;
    if (!responsibleUserId) {
      return res.status(400).json({ message: 'Le responsable est obligatoire.' });
    }

    const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
    const { rows } = await req.db.query(
      `INSERT INTO operational_incidents (
         organisation_id, incident_number, service_key, title, description,
         severity, impact_summary, responsible_user_id, links, evidence,
         idempotency_key, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (organisation_id,idempotency_key)
       DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [
        req.organisationId,
        body.incidentNumber || `INC-${Date.now()}`,
        body.serviceKey,
        body.title,
        body.description,
        body.severity,
        body.impactSummary,
        responsibleUserId,
        JSON.stringify(body.links || []),
        JSON.stringify(body.evidence || []),
        idempotencyKey,
        req.user?.id || null,
      ],
    );
    return res.status(201).json({ incident: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/:action', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Incident');
    const action = req.params.action;
    const body = req.body || {};

    const transitions = {
      contain: { from: ['declared'], to: 'contained', timestamp: 'contained_at' },
      restore: { from: ['contained'], to: 'restored', timestamp: 'restored_at' },
      close: { from: ['restored'], to: 'closed', timestamp: 'closed_at' },
    };
    const transition = transitions[action];
    if (!transition) return res.status(404).json({ message: 'Action inconnue.' });

    if (action === 'restore') {
      if (!String(body.restorationProof || '').trim() || !String(body.provisionalCause || '').trim()) {
        return res.status(400).json({ message: 'La preuve de rétablissement et la cause provisoire sont obligatoires.' });
      }
    }
    if (action === 'close' && !String(body.closureSummary || '').trim()) {
      return res.status(400).json({ message: 'Le résumé de clôture est obligatoire.' });
    }

    const current = (await req.db.query(
      'SELECT * FROM operational_incidents WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
      [id, req.organisationId],
    )).rows[0];
    if (!current) throw notFound('Incident introuvable.');
    checkBlockClosure(current, { finalStates: ['closed'] });
    if (!transition.from.includes(current.status)) {
      return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
    }

    const extraColumns = [];
    const params = [req.organisationId, id, transition.to];
    if (action === 'restore') {
      params.push(body.restorationProof, body.provisionalCause);
      extraColumns.push(`restoration_proof=$${params.length - 1}`, `provisional_cause=$${params.length}`);
    }
    if (action === 'close') {
      params.push(body.closureSummary);
      extraColumns.push(`closure_summary=$${params.length}`);
    }
    const setSql = [`status=$3`, `${transition.timestamp}=NOW()`, 'updated_at=NOW()', ...extraColumns].join(', ');

    const { rows } = await req.db.query(
      `UPDATE operational_incidents SET ${setSql} WHERE organisation_id=$1 AND id=$2 RETURNING *`,
      params,
    );
    return res.json({ incident: rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
