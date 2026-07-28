'use strict';

const crypto = require('crypto');
const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');

router.use(requireOrganisation);

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error(`${label} invalide.`), { statusCode: 400 });
  return id;
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(`SELECT a.*,e.employee_number,e.legal_name FROM payroll_vacation_accounts a JOIN payroll_employees e ON e.id=a.employee_id AND e.organisation_id=a.organisation_id WHERE a.organisation_id=$1 ORDER BY e.legal_name`, [req.organisationId]);
    return res.json({ vacationAccounts: rows });
  } catch (error) { return next(error); }
});

router.get('/:employeeId/movements', async (req, res, next) => {
  try {
    const employeeId = positiveId(req.params.employeeId, 'Employé');
    const { rows } = await req.db.query(`SELECT * FROM payroll_vacation_movements WHERE organisation_id=$1 AND employee_id=$2 ORDER BY created_at DESC,id DESC`, [req.organisationId, employeeId]);
    return res.json({ movements: rows });
  } catch (error) { return next(error); }
});

router.post('/:employeeId/movements', async (req, res, next) => {
  const client = req.db;
  try {
    const employeeId = positiveId(req.params.employeeId, 'Employé');
    const body = req.body || {};
    const allowed = ['accrual','payment','adjustment','reversal'];
    const amount = Number(body.amount);
    if (!allowed.includes(body.movementType) || !Number.isFinite(amount) || amount === 0) return res.status(400).json({ message: 'Le mouvement de vacances est invalide.' });
    if (body.movementType === 'payment' && amount < 0) return res.status(400).json({ message: 'Un paiement de vacances doit être positif.' });
    const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
    await client.query('BEGIN');
    const account = await client.query(`INSERT INTO payroll_vacation_accounts (organisation_id,employee_id,accrual_rate) SELECT $1,id,COALESCE($3,4) FROM payroll_employees WHERE organisation_id=$1 AND id=$2 ON CONFLICT (organisation_id,employee_id) DO UPDATE SET accrual_rate=COALESCE($3,payroll_vacation_accounts.accrual_rate),updated_at=NOW() RETURNING *`, [req.organisationId, employeeId, body.accrualRate == null ? null : Number(body.accrualRate)]);
    if (!account.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Employé introuvable.' }); }
    const movement = await client.query(`INSERT INTO payroll_vacation_movements (organisation_id,employee_id,payroll_run_id,movement_type,amount,reason,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (organisation_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`, [req.organisationId, employeeId, body.payrollRunId || null, body.movementType, amount, body.reason || null, idempotencyKey]);
    if (body.movementType === 'accrual') await client.query(`UPDATE payroll_vacation_accounts SET accrued_amount=accrued_amount+$3,updated_at=NOW() WHERE organisation_id=$1 AND employee_id=$2`, [req.organisationId, employeeId, amount]);
    else if (body.movementType === 'payment') await client.query(`UPDATE payroll_vacation_accounts SET paid_amount=paid_amount+$3,updated_at=NOW() WHERE organisation_id=$1 AND employee_id=$2 AND available_amount >= $3`, [req.organisationId, employeeId, amount]);
    else await client.query(`UPDATE payroll_vacation_accounts SET accrued_amount=accrued_amount+$3,updated_at=NOW() WHERE organisation_id=$1 AND employee_id=$2`, [req.organisationId, employeeId, amount]);
    const updated = await client.query(`SELECT * FROM payroll_vacation_accounts WHERE organisation_id=$1 AND employee_id=$2`, [req.organisationId, employeeId]);
    if (Number(updated.rows[0].available_amount) < 0) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Le mouvement produirait un solde de vacances négatif.' }); }
    await client.query('COMMIT');
    return res.status(201).json({ vacationAccount: updated.rows[0], movement: movement.rows[0] });
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} return next(error); }
});

module.exports = router;
