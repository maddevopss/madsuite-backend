'use strict';

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { buildFinalPay, buildRoePayload } = require('../../services/business/payroll-termination.service');

router.use(requireOrganisation);

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error(`${label} invalide.`), { statusCode: 400 });
  return id;
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT t.*, e.employee_number, e.legal_name
         FROM payroll_terminations t
         JOIN payroll_employees e ON e.id = t.employee_id AND e.organisation_id = t.organisation_id
        WHERE t.organisation_id = $1
        ORDER BY t.last_day_worked DESC, t.id DESC`,
      [req.organisationId],
    );
    return res.json({ terminations: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const employeeId = positiveId(req.body?.employeeId, 'Employé');
    const { lastWorkedDate, finalPayDate, reasonCode } = req.body || {};
    if (!lastWorkedDate || !finalPayDate || !reasonCode) {
      return res.status(400).json({ message: 'La dernière journée travaillée, la date de paie finale et le motif sont obligatoires.' });
    }
    const finalPay = buildFinalPay({
      regular: req.body?.regular,
      vacation: req.body?.vacationPayout,
      severance: req.body?.severanceAmount,
      other: req.body?.otherAmount,
    });
    const { rows } = await req.db.query(
      `INSERT INTO payroll_terminations
        (organisation_id, employee_id, last_day_worked, reason_code, final_pay_date,
         vacation_payout, severance_amount, other_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (organisation_id, employee_id, last_day_worked) DO NOTHING
       RETURNING *`,
      [req.organisationId, employeeId, lastWorkedDate, reasonCode, finalPayDate, finalPay.vacation, finalPay.severance, finalPay.other, req.user?.id || null],
    );
    if (!rows[0]) return res.status(409).json({ message: 'Une fin d’emploi existe déjà pour cet employé à cette date.' });
    return res.status(201).json({ termination: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/:action', async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Fin d’emploi');
    const action = req.params.action;
    const transitions = {
      approve: { from: ['draft'], to: 'approved' },
      issue: { from: ['approved'], to: 'issued' },
      cancel: { from: ['draft', 'approved'], to: 'cancelled' },
    };
    const transition = transitions[action];
    if (!transition) return res.status(404).json({ message: 'Action de fin d’emploi inconnue.' });

    const current = await req.db.query(
      `SELECT t.*, e.employee_number
         FROM payroll_terminations t
         JOIN payroll_employees e ON e.id = t.employee_id AND e.organisation_id = t.organisation_id
        WHERE t.organisation_id=$1 AND t.id=$2 FOR UPDATE`,
      [req.organisationId, id],
    );
    if (!current.rows[0]) return res.status(404).json({ message: 'Fin d’emploi introuvable.' });
    if (!transition.from.includes(current.rows[0].status)) {
      return res.status(409).json({ message: 'La fin d’emploi ne peut pas subir cette transition dans son état actuel.' });
    }

    let roePayload = current.rows[0].roe_payload || {};
    if (action === 'issue') {
      if (!req.body?.roeReference) return res.status(400).json({ message: 'Une référence de relevé d’emploi est obligatoire pour l’émission.' });
      roePayload = {
        ...buildRoePayload({
          employeeNumber: current.rows[0].employee_number,
          lastDayWorked: current.rows[0].last_day_worked,
          finalPayDate: current.rows[0].final_pay_date,
          reasonCode: current.rows[0].reason_code,
        }),
        roeReference: String(req.body.roeReference),
      };
    }

    const issuedAtSql = action === 'issue' ? ', issued_at=NOW()' : '';
    const { rows } = await req.db.query(
      `UPDATE payroll_terminations SET status=$3, roe_payload=$4${issuedAtSql} WHERE organisation_id=$1 AND id=$2 RETURNING *`,
      [req.organisationId, id, transition.to, JSON.stringify(roePayload)],
    );
    return res.json({ termination: rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
