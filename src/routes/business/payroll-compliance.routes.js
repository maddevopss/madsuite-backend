const router = require('express').Router();
const { buildComplianceSummary } = require('../../services/business/payroll-compliance-summary.service');
const requireOrganisation = require('../../middleware/requireOrganisation');

router.use(requireOrganisation);

router.get('/summary', async (req, res, next) => {
  try {
    const organisationId = req.organisationId;
    const [remittances, vacationBanks, terminations, deposits, slips] = await Promise.all([
      req.db.query('SELECT status,due_date AS "dueDate" FROM payroll_remittances WHERE organisation_id=$1', [organisationId]),
      req.db.query('SELECT available_amount AS "availableAmount" FROM payroll_vacation_banks WHERE organisation_id=$1', [organisationId]),
      req.db.query('SELECT status FROM payroll_terminations WHERE organisation_id=$1', [organisationId]),
      req.db.query('SELECT status,confirmed_at AS "confirmedAt" FROM payroll_direct_deposit_batches WHERE organisation_id=$1', [organisationId]),
      req.db.query('SELECT status FROM payroll_year_end_slips WHERE organisation_id=$1', [organisationId]),
    ]);
    return res.json(buildComplianceSummary({
      remittances: remittances.rows,
      vacationBanks: vacationBanks.rows,
      terminations: terminations.rows,
      deposits: deposits.rows,
      slips: slips.rows,
    }));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
