'use strict';

const router = require('express').Router();
const { requireOrganisation } = require('../../middleware/organization.middleware');

router.use(requireOrganisation);

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

module.exports = router;
