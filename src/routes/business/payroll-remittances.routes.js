'use strict';

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { buildRemittance } = require('../../services/business/payroll-remittance.service');
const payrollDepositsRoutes = require('./payroll-deposits.routes');
const payrollVacationsRoutes = require('./payroll-vacations.routes');
const payrollTerminationsRoutes = require('./payroll-terminations.routes');
const payrollYearEndSlipsRoutes = require('./payroll-year-end-slips.routes');

router.use(requireOrganisation);
router.use('/deposits', payrollDepositsRoutes);
router.use('/vacations', payrollVacationsRoutes);
router.use('/terminations', payrollTerminationsRoutes);
router.use('/year-end-slips', payrollYearEndSlipsRoutes);

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
      `SELECT *
         FROM payroll_remittances
        WHERE organisation_id=$1
        ORDER BY due_date ASC, id DESC`,
      [req.organisationId],
    );
    return res.json({ remittances: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!['CRA', 'RQ', 'CNESST', 'OTHER'].includes(body.authority)) {
      return res.status(400).json({ message: 'Autorité de remise invalide.' });
    }
    if (!body.remittanceType || !body.periodStart || !body.periodEnd) {
      return res.status(400).json({ message: 'Le type et la période de remise sont obligatoires.' });
    }

    const amounts = buildRemittance({
      employeeAmount: body.employeeAmount,
      employerAmount: body.employerAmount,
      dueDate: body.dueDate,
    });
    const idempotencyKey = body.idempotencyKey || crypto.randomUUID();

    const { rows } = await req.db.query(
      `INSERT INTO payroll_remittances (
         organisation_id, payroll_run_id, authority, remittance_type,
         period_start, period_end, due_date, employee_amount,
         employer_amount, evidence, idempotency_key, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (organisation_id,idempotency_key)
       DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [
        req.organisationId,
        body.payrollRunId || null,
        body.authority,
        body.remittanceType,
        body.periodStart,
        body.periodEnd,
        amounts.dueDate,
        amounts.employeeAmount,
        amounts.employerAmount,
        body.evidence || [],
        idempotencyKey,
        req.user?.id || null,
      ],
    );
    return res.status(201).json({ remittance: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/:action', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Remise');
    const action = req.params.action;
    const transitions = {
      approve: { from: ['draft'], to: 'approved', timestamp: null },
      submit: { from: ['approved'], to: 'submitted', timestamp: 'submitted_at' },
      pay: { from: ['submitted'], to: 'paid', timestamp: 'paid_at' },
      void: { from: ['draft', 'approved', 'submitted'], to: 'void', timestamp: null },
    };
    const transition = transitions[action];
    if (!transition) return res.status(404).json({ message: 'Action de remise inconnue.' });
    if (action === 'pay' && !String(req.body?.confirmationNumber || '').trim()) {
      return res.status(400).json({ message: 'Le numéro de confirmation est obligatoire pour marquer la remise payée.' });
    }

    const timestampSql = transition.timestamp ? `, ${transition.timestamp}=NOW()` : '';
    const confirmationSql = action === 'pay' ? ', confirmation_number=$4' : '';
    const params = action === 'pay'
      ? [req.organisationId, id, transition.to, String(req.body.confirmationNumber).trim()]
      : [req.organisationId, id, transition.to];

    const { rows } = await req.db.query(
      `UPDATE payroll_remittances
          SET status=$3${timestampSql}${confirmationSql}
        WHERE organisation_id=$1
          AND id=$2
          AND status = ANY($${params.length + 1}::text[])
        RETURNING *`,
      [...params, transition.from],
    );
    if (!rows[0]) {
      return res.status(409).json({ message: 'La remise est introuvable ou sa transition d’état est invalide.' });
    }
    return res.json({ remittance: rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
