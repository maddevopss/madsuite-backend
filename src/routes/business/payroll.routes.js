const crypto = require("crypto");
const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const payrollService = require("../../services/business/payroll-transaction.service");

router.use(requireOrganisation);
router.use(requireRole("admin"));

router.get("/employees", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      "SELECT * FROM payroll_employees WHERE organisation_id = $1 ORDER BY legal_name",
      [req.organisationId],
    );
    return res.json({ employees: rows });
  } catch (error) { return next(error); }
});

router.post("/employees", async (req, res, next) => {
  try {
    const body = req.body;
    if (!body.employeeNumber || !body.legalName || !body.hireDate || !["hourly", "salary"].includes(body.payType)) {
      return res.status(400).json({ message: "Les renseignements essentiels de l’employé sont invalides." });
    }
    if (body.payType === "hourly" && Number(body.hourlyRate) <= 0) return res.status(400).json({ message: "Le taux horaire doit être supérieur à zéro." });
    if (body.payType === "salary" && Number(body.annualSalary) <= 0) return res.status(400).json({ message: "Le salaire annuel doit être supérieur à zéro." });
    const { rows } = await req.db.query(
      `INSERT INTO payroll_employees
       (organisation_id,user_id,employee_number,legal_name,hire_date,pay_type,hourly_rate,annual_salary,province,tax_profile)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.organisationId, body.userId || null, body.employeeNumber, body.legalName, body.hireDate, body.payType,
        body.hourlyRate || null, body.annualSalary || null, body.province || "QC", body.taxProfile || {}],
    );
    return res.status(201).json({ employee: rows[0] });
  } catch (error) { return next(error); }
});

router.get("/rulesets", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(`SELECT id,version,province,effective_from,effective_to,status,checksum,created_at FROM payroll_rulesets WHERE organisation_id=$1 ORDER BY effective_from DESC`, [req.organisationId]);
    return res.json({ rulesets: rows });
  } catch (error) { return next(error); }
});

router.post("/rulesets", async (req, res, next) => {
  try {
    const body = req.body;
    if (!body.version || !body.effectiveFrom || !body.rules || typeof body.rules !== "object") return res.status(400).json({ message: "Version, date d’effet et règles sont obligatoires." });
    const checksum = crypto.createHash("sha256").update(JSON.stringify(body.rules)).digest("hex");
    const { rows } = await req.db.query(`INSERT INTO payroll_rulesets (organisation_id,version,province,effective_from,effective_to,rules,checksum,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.organisationId, body.version, body.province || "QC", body.effectiveFrom, body.effectiveTo || null, body.rules, checksum, body.status || "draft", req.user?.id || null]);
    return res.status(201).json({ ruleset: rows[0] });
  } catch (error) { return next(error); }
});

router.get("/runs", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(`SELECT r.*,rs.version AS ruleset_version FROM payroll_runs r LEFT JOIN payroll_rulesets rs ON rs.id=r.ruleset_id AND rs.organisation_id=r.organisation_id WHERE r.organisation_id=$1 ORDER BY r.period_end DESC`, [req.organisationId]);
    return res.json({ runs: rows });
  } catch (error) { return next(error); }
});

router.post("/runs", async (req, res, next) => {
  try {
    const body = req.body;
    if (!body.periodStart || !body.periodEnd || !body.payDate || !body.rulesetId) return res.status(400).json({ message: "La période, la date de paiement et le jeu de règles sont obligatoires." });
    const { rows } = await req.db.query(`INSERT INTO payroll_runs (organisation_id,period_start,period_end,pay_date,ruleset_id,ruleset_version) SELECT $1,$2,$3,$4,id,version FROM payroll_rulesets WHERE organisation_id=$1 AND id=$5 AND status='active' RETURNING *`, [req.organisationId, body.periodStart, body.periodEnd, body.payDate, body.rulesetId]);
    if (!rows[0]) return res.status(409).json({ message: "Le jeu de règles doit être actif." });
    return res.status(201).json({ run: rows[0] });
  } catch (error) { return next(error); }
});

router.get("/runs/:id", async (req, res, next) => {
  try {
    const run = await req.db.query(`SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2`, [req.organisationId, req.params.id]);
    if (!run.rows[0]) return res.status(404).json({ message: "Cycle de paie introuvable." });
    const lines = await req.db.query(`SELECT l.*,e.employee_number,e.legal_name FROM payroll_run_lines l JOIN payroll_employees e ON e.id=l.employee_id AND e.organisation_id=l.organisation_id WHERE l.organisation_id=$1 AND l.payroll_run_id=$2 ORDER BY e.legal_name`, [req.organisationId, req.params.id]);
    return res.json({ run: run.rows[0], lines: lines.rows });
  } catch (error) { return next(error); }
});

router.post("/runs/:id/calculate", async (req, res, next) => {
  try {
    const result = await payrollService.calculateRun({ organisationId: req.organisationId, runId: Number(req.params.id), entries: req.body.entries || [], idempotencyKey: req.body.idempotencyKey, createdBy: req.user?.id });
    if (!result) return res.status(404).json({ message: "Cycle de paie introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

for (const action of ["approve", "pay", "void"]) {
  router.post(`/runs/:id/${action}`, async (req, res, next) => {
    try {
      const result = await payrollService.transitionRun({ organisationId: req.organisationId, runId: Number(req.params.id), action, reason: req.body.reason, idempotencyKey: req.body.idempotencyKey, createdBy: req.user?.id });
      if (!result) return res.status(404).json({ message: "Cycle de paie introuvable." });
      return res.status(201).json(result);
    } catch (error) { return next(error); }
  });
}

module.exports = router;
