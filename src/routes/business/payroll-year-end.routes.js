'use strict';

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');

router.use(requireOrganisation);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT s.*, e.employee_number, e.legal_name
         FROM payroll_year_end_slips s
         JOIN payroll_employees e ON e.id = s.employee_id AND e.organisation_id = s.organisation_id
        WHERE s.organisation_id = $1
        ORDER BY s.tax_year DESC, e.legal_name`,
      [req.organisationId],
    );
    return res.json({ yearEndSlips: rows });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
