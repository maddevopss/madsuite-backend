'use strict';

// Étage 8 PR D — Changements et fenêtres d'entretien (issue #194).
// Demande → approbation indépendante (l'approbateur ne peut pas être le
// demandeur ; risque élevé/critique exige un approbateur admin) →
// planification (fenêtre, calendrier) → exécution (preuve obligatoire) →
// retour arrière possible (motif obligatoire). Rejet/annulation/retour
// arrière sont des états terminaux.

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const { checkBlockClosure } = require('../../utils/blockClosureValidation');

router.use(requireOrganisation);
router.use(requireRole('admin', 'manager'));

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const TERMINAL_STATES = ['rejected', 'cancelled', 'rolled_back'];

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
    const { status, riskLevel } = req.query;
    const conditions = ['organisation_id=$1'];
    const params = [req.organisationId];
    if (status) {
      params.push(status);
      conditions.push(`status=$${params.length}`);
    }
    if (riskLevel) {
      params.push(riskLevel);
      conditions.push(`risk_level=$${params.length}`);
    }
    const { rows } = await req.db.query(
      `SELECT * FROM operational_changes WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      params,
    );
    return res.json({ changes: rows });
  } catch (error) {
    return next(error);
  }
});

// Calendrier des changements : toute fenêtre planifiée, passée ou à venir.
router.get('/calendar', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM operational_changes
        WHERE organisation_id=$1 AND scheduled_window_start IS NOT NULL
        ORDER BY scheduled_window_start ASC`,
      [req.organisationId],
    );
    return res.json({ calendar: rows });
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
    if (!RISK_LEVELS.includes(body.riskLevel)) {
      return res.status(400).json({ message: 'Niveau de risque invalide.' });
    }
    if (!String(body.rollbackPlan || '').trim()) {
      return res.status(400).json({ message: 'Le plan de retour arrière est obligatoire.' });
    }
    const requestedBy = req.user?.id;
    if (!requestedBy) {
      return res.status(400).json({ message: 'Le demandeur est obligatoire.' });
    }

    const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
    const { rows } = await req.db.query(
      `INSERT INTO operational_changes (
         organisation_id, change_number, title, description, risk_level,
         rollback_plan, requested_by, evidence, idempotency_key, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (organisation_id,idempotency_key)
       DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [
        req.organisationId,
        body.changeNumber || `CHG-${Date.now()}`,
        body.title,
        body.description,
        body.riskLevel,
        body.rollbackPlan,
        requestedBy,
        JSON.stringify(body.evidence || []),
        idempotencyKey,
        requestedBy,
      ],
    );
    return res.status(201).json({ change: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/:action', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Changement');
    const action = req.params.action;
    const body = req.body || {};

    const current = (await req.db.query(
      'SELECT * FROM operational_changes WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
      [id, req.organisationId],
    )).rows[0];
    if (!current) throw notFound('Changement introuvable.');
    checkBlockClosure(current, { finalStates: TERMINAL_STATES });

    if (action === 'approve') {
      if (current.status !== 'requested') return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
      const approverId = req.user?.id;
      // Approbation indépendante : l'approbateur ne peut pas être le demandeur.
      if (String(approverId) === String(current.requested_by)) {
        return res.status(409).json({ message: 'Le demandeur ne peut pas approuver son propre changement.' });
      }
      // Risque élevé/critique : approbateur admin obligatoire.
      if (['high', 'critical'].includes(current.risk_level) && req.user?.role !== 'admin') {
        return res.status(403).json({ message: 'Un changement à risque élevé ou critique exige un approbateur admin.' });
      }
      const { rows } = await req.db.query(
        `UPDATE operational_changes SET status='approved', approved_by=$3, approved_at=NOW(), updated_at=NOW()
          WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [req.organisationId, id, approverId],
      );
      return res.json({ change: rows[0] });
    }

    if (action === 'reject') {
      if (current.status !== 'requested') return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
      if (!String(body.reason || '').trim()) return res.status(400).json({ message: 'Le motif de rejet est obligatoire.' });
      const { rows } = await req.db.query(
        `UPDATE operational_changes SET status='rejected', rejection_reason=$3, updated_at=NOW()
          WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [req.organisationId, id, body.reason],
      );
      return res.json({ change: rows[0] });
    }

    if (action === 'schedule') {
      if (current.status !== 'approved') return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
      const start = body.windowStart ? new Date(body.windowStart) : null;
      const end = body.windowEnd ? new Date(body.windowEnd) : null;
      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return res.status(400).json({ message: 'La fenêtre planifiée (début/fin) est invalide.' });
      }
      const { rows } = await req.db.query(
        `UPDATE operational_changes SET status='scheduled', scheduled_window_start=$3, scheduled_window_end=$4, updated_at=NOW()
          WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [req.organisationId, id, start.toISOString(), end.toISOString()],
      );
      return res.json({ change: rows[0] });
    }

    if (action === 'execute') {
      if (current.status !== 'scheduled') return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
      if (!String(body.executionProof || '').trim()) return res.status(400).json({ message: "La preuve d'exécution est obligatoire." });
      const { rows } = await req.db.query(
        `UPDATE operational_changes SET status='executed', executed_at=NOW(), execution_proof=$3, updated_at=NOW()
          WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [req.organisationId, id, body.executionProof],
      );
      return res.json({ change: rows[0] });
    }

    if (action === 'rollback') {
      if (current.status !== 'executed') return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
      if (!String(body.rollbackReason || '').trim()) return res.status(400).json({ message: 'Le motif de retour arrière est obligatoire.' });
      const { rows } = await req.db.query(
        `UPDATE operational_changes SET status='rolled_back', rolled_back_at=NOW(), rollback_reason=$3, updated_at=NOW()
          WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [req.organisationId, id, body.rollbackReason],
      );
      return res.json({ change: rows[0] });
    }

    if (action === 'cancel') {
      if (!['requested', 'approved', 'scheduled'].includes(current.status)) {
        return res.status(409).json({ message: 'Transition invalide depuis le statut courant.' });
      }
      const { rows } = await req.db.query(
        `UPDATE operational_changes SET status='cancelled', cancellation_reason=$3, updated_at=NOW()
          WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [req.organisationId, id, body.reason || null],
      );
      return res.json({ change: rows[0] });
    }

    return res.status(404).json({ message: 'Action inconnue.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
