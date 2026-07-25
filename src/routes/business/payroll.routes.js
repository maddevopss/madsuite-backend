const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");

router.use(requireOrganisation);
router.use(requireRole("admin"));

router.get("/employees", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      "SELECT * FROM payroll_employees WHERE organisation_id = $1 ORDER BY legal_name",
      [req.organisationId],
    );
    res.json({ employees: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/employees", async (req, res, next) => {
  try {
    const body = req.body;
    const { rows } = await req.db.query(
      `INSERT INTO payroll_employees
       (organisation_id, user_id, employee_number, legal_name, hire_date, pay_type,
        hourly_rate, annual_salary, province, tax_profile)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.organisationId,
        body.userId || null,
        body.employeeNumber,
        body.legalName,
        body.hireDate,
        body.payType,
        body.hourlyRate || null,
        body.annualSalary || null,
        body.province || "QC",
        body.taxProfile || {},
      ],
    );
    res.status(201).json({ employee: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get("/runs", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      "SELECT * FROM payroll_runs WHERE organisation_id = $1 ORDER BY period_end DESC",
      [req.organisationId],
    );
    res.json({ runs: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/runs", async (req, res, next) => {
  try {
    const body = req.body;
    const { rows } = await req.db.query(
      `INSERT INTO payroll_runs
       (organisation_id, period_start, period_end, pay_date, ruleset_version)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [req.organisationId, body.periodStart, body.periodEnd, body.payDate, body.rulesetVersion],
    );
    res.status(201).json({
      run: rows[0],
      warning: "Le calcul fiscal doit utiliser un jeu de règles québécois validé et versionné.",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
