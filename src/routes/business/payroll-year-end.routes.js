'use strict';

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');
const requireRole = require('../../middleware/requireRole');
const { buildYearEndSlip } = require('../../services/business/payroll-year-end.service');

router.use(requireOrganisation);

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error(`${label} invalide.`), { statusCode: 400 });
  return id;
}

// L'UI propose "RL-1"/"RL-2" (lisible), la contrainte de la base exige "RL1"/"RL2".
function normalizeSlipType(value) {
  return String(value || '').toUpperCase().replace(/-/g, '');
}

router.get('/', async (req, res, next) => {
  try {
    const values = [req.organisationId];
    let filter = '';
    if (req.query?.employeeId) {
      values.push(positiveId(req.query.employeeId, 'Employé'));
      filter += ` AND s.employee_id=$${values.length}`;
    }
    if (req.query?.taxYear) {
      values.push(Number(req.query.taxYear));
      filter += ` AND s.tax_year=$${values.length}`;
    }
    const { rows } = await req.db.query(
      `SELECT s.*, e.employee_number, e.legal_name
         FROM payroll_year_end_slips s
         JOIN payroll_employees e ON e.id = s.employee_id AND e.organisation_id = s.organisation_id
        WHERE s.organisation_id = $1${filter}
        ORDER BY s.tax_year DESC, e.legal_name`,
      values,
    );
    return res.json({ slips: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const employeeId = positiveId(req.body?.employeeId, 'Employé');
    const taxYear = Number(req.body?.taxYear);
    if (!Number.isInteger(taxYear) || taxYear < 2000) return res.status(400).json({ message: 'L’année fiscale est invalide.' });
    const slip = buildYearEndSlip({
      slipType: normalizeSlipType(req.body?.slipType),
      earnings: req.body?.earnings,
      tax: req.body?.tax,
      pension: req.body?.pension,
      insurance: req.body?.insurance,
      other: req.body?.other,
    });
    const { rows } = await req.db.query(
      `INSERT INTO payroll_year_end_slips
        (organisation_id, employee_id, tax_year, slip_type, boxes, totals, source_hash, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (organisation_id, employee_id, tax_year, slip_type, source_hash) DO NOTHING
       RETURNING *`,
      [req.organisationId, employeeId, taxYear, slip.slipType, JSON.stringify(slip.boxes), JSON.stringify(slip.boxes), slip.sourceHash, req.user?.id || null],
    );
    if (!rows[0]) return res.status(409).json({ message: 'Un feuillet identique existe déjà pour cet employé et cette année.' });
    return res.status(201).json({ slip: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/:action', requireRole('admin'), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, 'Feuillet');
    const action = req.params.action;

    if (action === 'amend') {
      const original = await req.db.query(`SELECT * FROM payroll_year_end_slips WHERE organisation_id=$1 AND id=$2 FOR UPDATE`, [req.organisationId, id]);
      if (!original.rows[0]) return res.status(404).json({ message: 'Feuillet introuvable.' });
      const slip = buildYearEndSlip({
        slipType: original.rows[0].slip_type,
        earnings: req.body?.earnings,
        tax: req.body?.tax,
        pension: req.body?.pension,
        insurance: req.body?.insurance,
        other: req.body?.other,
      });
      const amended = await req.db.query(
        `INSERT INTO payroll_year_end_slips
          (organisation_id, employee_id, tax_year, slip_type, boxes, totals, source_hash, amended_from_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [req.organisationId, original.rows[0].employee_id, original.rows[0].tax_year, slip.slipType, JSON.stringify(slip.boxes), JSON.stringify(slip.boxes), slip.sourceHash, id, req.user?.id || null],
      );
      await req.db.query(`UPDATE payroll_year_end_slips SET status='amended' WHERE organisation_id=$1 AND id=$2`, [req.organisationId, id]);
      return res.status(201).json({ slip: amended.rows[0] });
    }

    const transitions = {
      validate: { from: ['draft'], to: 'validated' },
      issue: { from: ['validated'], to: 'issued' },
      cancel: { from: ['draft', 'validated'], to: 'cancelled' },
    };
    const transition = transitions[action];
    if (!transition) return res.status(404).json({ message: 'Action de feuillet inconnue.' });
    if (action === 'issue' && !req.body?.approvalReference) {
      return res.status(400).json({ message: 'Une référence d’approbation est obligatoire pour l’émission.' });
    }

    const current = await req.db.query(`SELECT * FROM payroll_year_end_slips WHERE organisation_id=$1 AND id=$2 FOR UPDATE`, [req.organisationId, id]);
    if (!current.rows[0]) return res.status(404).json({ message: 'Feuillet introuvable.' });
    if (!transition.from.includes(current.rows[0].status)) {
      return res.status(409).json({ message: 'Le feuillet ne peut pas subir cette transition dans son état actuel.' });
    }

    const issuedAtSql = action === 'issue' ? ', issued_at=NOW()' : '';
    const { rows } = await req.db.query(
      `UPDATE payroll_year_end_slips SET status=$3${issuedAtSql} WHERE organisation_id=$1 AND id=$2 RETURNING *`,
      [req.organisationId, id, transition.to],
    );
    return res.json({ slip: rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
