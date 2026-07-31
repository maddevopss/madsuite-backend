'use strict';

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');

router.use(requireOrganisation);

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

module.exports = router;
