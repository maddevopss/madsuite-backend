'use strict';

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { reconcilePayroll } = require('../../services/business/payroll-reconciliation.service');

router.use(requireOrganisation);

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error(`${label} invalide.`), { statusCode: 400 });
  return id;
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT *
         FROM payroll_reconciliation_runs
        WHERE organisation_id = $1
        ORDER BY reconciled_at DESC, id DESC`,
      [req.organisationId],
    );
    return res.json({ reconciliations: rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/runs/:id/summary', async (req, res, next) => {
  try {
    const runId = positiveId(req.params.id, 'Cycle');
    const { rows } = await req.db.query(
      `SELECT *
         FROM payroll_reconciliation_runs
        WHERE organisation_id = $1 AND payroll_run_id = $2
        ORDER BY reconciled_at DESC, id DESC
        LIMIT 1`,
      [req.organisationId, runId],
    );
    return res.json({ reconciliation: rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

router.post('/runs/:id', async (req, res, next) => {
  try {
    const runId = positiveId(req.params.id, 'Cycle');
    const run = await req.db.query(
      `SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2 AND status IN ('approved','paid')`,
      [req.organisationId, runId],
    );
    if (!run.rows[0]) return res.status(409).json({ message: 'Le cycle doit être approuvé avant son rapprochement.' });
    if (req.body?.depositedNet == null) return res.status(400).json({ message: 'Le montant net déposé est obligatoire.' });

    const result = reconcilePayroll({
      expectedNet: run.rows[0].totals?.net,
      depositedNet: req.body.depositedNet,
      remittedTotal: req.body?.remittedTotal,
    });
    const idempotencyKey = req.body?.idempotencyKey || crypto.randomUUID();

    const { rows } = await req.db.query(
      `INSERT INTO payroll_reconciliation_runs
        (organisation_id, payroll_run_id, expected_net, deposited_net, remitted_total, variance, status, findings, reconciled_by, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (organisation_id, idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING *`,
      [req.organisationId, runId, result.expectedNet, result.depositedNet, result.remittedTotal, result.variance, result.status, JSON.stringify(result.findings), req.user?.id || null, idempotencyKey],
    );
    return res.status(201).json({ reconciliation: rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
