'use strict';

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const { buildPaymentBatch } = require('../../services/business/payroll-direct-deposit.service');

router.use(requireOrganisation);

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error(`${label} invalide.`), { statusCode: 400 });
  }
  return id;
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.*, r.period_start, r.period_end, r.pay_date
         FROM payroll_payment_batches b
         JOIN payroll_runs r
           ON r.organisation_id=b.organisation_id
          AND r.id=b.payroll_run_id
        WHERE b.organisation_id=$1
        ORDER BY b.payment_date DESC, b.id DESC`,
      [req.organisationId],
    );
    return res.json({ batches: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const payrollRunId = positiveId(body.payrollRunId, 'Cycle de paie');
    const paymentDate = String(body.paymentDate || '').trim();
    if (!paymentDate) {
      return res.status(400).json({ message: 'La date de paiement est obligatoire.' });
    }

    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID()).trim();
    const { rows } = await req.db.query(
      `INSERT INTO payroll_payment_batches (
         organisation_id, payroll_run_id, payment_date,
         total_amount, payment_count, idempotency_key
       )
       SELECT $1, r.id, $3,
              COALESCE((r.totals->>'net')::numeric, 0),
              COUNT(l.id)::integer,
              $4
         FROM payroll_runs r
         LEFT JOIN payroll_run_lines l
           ON l.organisation_id=r.organisation_id
          AND l.payroll_run_id=r.id
        WHERE r.organisation_id=$1
          AND r.id=$2
          AND r.status IN ('approved','paid')
        GROUP BY r.id
       ON CONFLICT (organisation_id,idempotency_key)
       DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [req.organisationId, payrollRunId, paymentDate, idempotencyKey],
    );
    if (!rows[0]) {
      return res.status(409).json({ message: 'Le cycle doit être approuvé avant de préparer les dépôts directs.' });
    }
    return res.status(201).json({ batch: rows[0] });
  } catch (error) {
    return next(error);
  }
});

// Approbation, export et confirmation d'un lot de dépôt direct sont des
// actions de gouvernance financière (le fichier exporté et confirmé
// déclenche un mouvement de fonds réel) — réservées admin, cohérent avec
// les routes soeurs de ce même groupe (remises, fins d'emploi, feuillets
// fiscaux) qui restreignent déjà leurs transitions à ce rôle. Cette route
// en était l'unique exception : sans ce contrôle, un manager pouvait
// approuver, exporter et confirmer un lot de dépôt direct.
router.post('/:id/:action', requireRole('admin'), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Lot de dépôts');
    const transitions = {
      approve: { from: ['draft'], to: 'approved' },
      export: { from: ['approved'], to: 'exported' },
      confirm: { from: ['exported'], to: 'confirmed' },
      void: { from: ['draft', 'approved', 'exported'], to: 'void' },
    };
    const transition = transitions[req.params.action];
    if (!transition) return res.status(404).json({ message: 'Action de dépôt inconnue.' });

    const confirmationNumber = String(req.body?.confirmationNumber || '').trim();
    if (req.params.action === 'confirm' && !confirmationNumber) {
      return res.status(400).json({ message: 'Le numéro de confirmation est obligatoire.' });
    }

    // L'export d'un lot de dépôt direct déclenche un fichier bancaire réel.
    // Le client soumet l'empreinte du fichier qu'il a généré, mais rien ne
    // garantissait auparavant que cette empreinte correspondait réellement
    // aux paiements du lot — un fichier corrompu, tronqué ou substitué
    // aurait été accepté tel quel. On recalcule ici l'empreinte attendue à
    // partir des paiements réels du cycle de paie (payroll_run_lines) avec
    // la même canonicalisation que buildPaymentBatch, et on refuse l'export
    // si elle ne correspond pas.
    let fileHash = null;
    if (req.params.action === 'export') {
      fileHash = String(req.body?.fileHash || '').trim();
      if (!fileHash) {
        return res.status(400).json({ message: 'L’empreinte du fichier exporté est obligatoire.' });
      }

      const batchForHash = await req.db.query(
        `SELECT payroll_run_id FROM payroll_payment_batches WHERE organisation_id=$1 AND id=$2`,
        [req.organisationId, id],
      );
      if (!batchForHash.rows[0]) {
        return res.status(404).json({ message: 'Lot de dépôts introuvable.' });
      }
      const lines = await req.db.query(
        `SELECT employee_id, net_pay FROM payroll_run_lines
          WHERE organisation_id=$1 AND payroll_run_id=$2
          ORDER BY employee_id`,
        [req.organisationId, batchForHash.rows[0].payroll_run_id],
      );
      const expected = buildPaymentBatch(
        lines.rows.map((line) => ({ employeeId: Number(line.employee_id), amount: line.net_pay })),
      );
      if (expected.fileHash !== fileHash) {
        return res.status(409).json({ message: 'L’empreinte du fichier exporté ne correspond pas aux paiements réels du lot.' });
      }
    }

    const confirmation = req.params.action === 'confirm'
      ? { number: confirmationNumber, confirmedAt: new Date().toISOString(), confirmedBy: req.user?.id || null }
      : null;

    const { rows } = await req.db.query(
      `UPDATE payroll_payment_batches
          SET status=$3,
              file_hash=COALESCE($4,file_hash),
              confirmation=CASE WHEN $5::jsonb IS NULL THEN confirmation ELSE $5::jsonb END
        WHERE organisation_id=$1
          AND id=$2
          AND status = ANY($6::text[])
        RETURNING *`,
      [
        req.organisationId,
        id,
        transition.to,
        fileHash,
        confirmation ? JSON.stringify(confirmation) : null,
        transition.from,
      ],
    );
    if (!rows[0]) {
      return res.status(409).json({ message: 'Le lot est introuvable ou sa transition d’état est invalide.' });
    }
    return res.json({ batch: rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
