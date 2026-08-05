'use strict';

// Étage 9 PR A — Registre des cas d'usage assistés (issue #195).
// Le catalogue (ai_use_cases) est un registre PLATEFORME, pas une
// ressource d'organisation : seul un super-admin plateforme peut y
// déclarer un nouveau cas d'usage ou une nouvelle version (voir
// requireSuperAdmin). Un admin d'organisation ne peut qu'ACTIVER pour son
// organisation un cas d'usage déjà 'approved' au catalogue — jamais un
// cas 'experimental' ou 'forbidden' : c'est le garde-fou contre
// l'activation implicite d'une fonction non approuvée exigé par le
// critère de fermeture de l'Étage 9.

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const requireSuperAdmin = require('../../middleware/requireSuperAdmin');
const { validateUseCase } = require('../../ai/assistedUseCaseRegistry');

router.use(requireOrganisation);

function notFound(message) {
  return Object.assign(new Error(message), { statusCode: 404 });
}

router.get('/', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { status } = req.query;
    const conditions = [];
    const params = [];
    if (status) {
      params.push(status);
      conditions.push(`status=$${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await req.db.query(`SELECT * FROM ai_use_cases ${where} ORDER BY id ASC, created_at DESC`, params);
    return res.json({ useCases: rows });
  } catch (error) {
    return next(error);
  }
});

// Déclaration/nouvelle version d'un cas d'usage au catalogue plateforme —
// réservé super-admin, jamais un admin d'organisation.
router.post('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    let validated;
    try {
      validated = validateUseCase({
        id: body.id,
        version: body.version,
        owner: body.owner,
        status: body.status,
        autonomy: body.autonomy,
        riskLevel: body.riskLevel,
        dataClasses: body.dataClasses,
      });
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }
    if (!String(body.description || '').trim()) {
      return res.status(400).json({ message: 'La description est obligatoire.' });
    }

    const { rows } = await req.db.query(
      `INSERT INTO ai_use_cases (id, version, owner, status, autonomy, risk_level, data_classes, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id, version) DO NOTHING
       RETURNING *`,
      [validated.id, validated.version, validated.owner, validated.status, validated.autonomy, validated.riskLevel, JSON.stringify(validated.dataClasses), body.description, req.user?.id || null],
    );
    if (!rows[0]) return res.status(409).json({ message: 'Cette version de ce cas d\'usage existe déjà au catalogue.' });
    return res.status(201).json({ useCase: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/activations', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      'SELECT * FROM ai_use_case_activations WHERE organisation_id=$1 ORDER BY use_case_id ASC',
      [req.organisationId],
    );
    return res.json({ activations: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/activate', requireRole('admin'), async (req, res, next) => {
  try {
    const useCaseId = req.params.id;
    const requestedVersion = req.body?.version;

    // Sans version demandée, on prend la plus récente déclarée quel que
    // soit son statut — sinon un cas 'experimental'/'forbidden' sans
    // version 'approved' semblerait "introuvable" (404) plutôt que
    // clairement refusé (409), ce qui masquerait la vraie raison du refus.
    const catalogEntry = requestedVersion
      ? (await req.db.query('SELECT * FROM ai_use_cases WHERE id=$1 AND version=$2', [useCaseId, requestedVersion])).rows[0]
      : (await req.db.query('SELECT * FROM ai_use_cases WHERE id=$1 ORDER BY created_at DESC LIMIT 1', [useCaseId])).rows[0];

    if (!catalogEntry) throw notFound('Cas d\'usage introuvable au catalogue.');
    if (catalogEntry.status !== 'approved') {
      return res.status(409).json({ message: `Ce cas d'usage est '${catalogEntry.status}' — seul un cas 'approved' peut être activé.`, code: 'ai.use_case.not_approved' });
    }

    const { rows } = await req.db.query(
      `INSERT INTO ai_use_case_activations (organisation_id, use_case_id, use_case_version, status, activated_by, activated_at, disabled_by, disabled_at)
       VALUES ($1,$2,$3,'active',$4,NOW(),NULL,NULL)
       ON CONFLICT (organisation_id, use_case_id)
       DO UPDATE SET use_case_version=EXCLUDED.use_case_version, status='active', activated_by=EXCLUDED.activated_by, activated_at=NOW(), disabled_by=NULL, disabled_at=NULL
       RETURNING *`,
      [req.organisationId, catalogEntry.id, catalogEntry.version, req.user?.id || null],
    );
    return res.status(201).json({ activation: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/deactivate', requireRole('admin'), async (req, res, next) => {
  try {
    const current = (await req.db.query(
      'SELECT * FROM ai_use_case_activations WHERE organisation_id=$1 AND use_case_id=$2',
      [req.organisationId, req.params.id],
    )).rows[0];
    if (!current) throw notFound('Ce cas d\'usage n\'a jamais été activé pour cette organisation.');
    if (current.status === 'disabled') return res.json({ activation: current, alreadyDisabled: true });

    const { rows } = await req.db.query(
      `UPDATE ai_use_case_activations SET status='disabled', disabled_by=$3, disabled_at=NOW()
        WHERE organisation_id=$1 AND use_case_id=$2 RETURNING *`,
      [req.organisationId, req.params.id, req.user?.id || null],
    );
    return res.json({ activation: rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
