const crypto = require("crypto");
const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const payrollService = require("../../services/business/payroll-transaction.service");
const { buildPayrollJournal, postPayrollJournal } = require("../../services/business/payroll-accounting.service");
const { reversePostedEntry } = require("../../services/business/accounting-reversal-governance.service");
const { buildPayStub, buildPayrollRegister } = require("../../services/business/payroll-documents.service");
const payrollRemittancesRoutes = require("./payroll-remittances.routes");
const payrollLifecycleRoutes = require("./payroll-lifecycle.routes");
const { checksumRules } = require("../../services/business/payroll-run-lifecycle.service");

router.use(requireOrganisation);
router.use(requireRole("admin"));
router.use("/remittances", payrollRemittancesRoutes);
router.use("/", payrollLifecycleRoutes);

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error(`${label} invalide.`), { statusCode: 400 });
  return id;
}

// legal_first_name/legal_last_name sont NOT NULL en base mais l'UI ne collecte
// qu'un seul champ "nom légal" (legalName) : on le scinde côté serveur.
function splitLegalName(legalName) {
  const trimmed = String(legalName || "").trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { firstName: trimmed, lastName: trimmed };
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1).trim() };
}

router.get("/employees", async (req, res, next) => {
  try {
    const { rows } = await req.db.query("SELECT * FROM payroll_employees WHERE organisation_id=$1 ORDER BY legal_name", [req.organisationId]);
    return res.json({ employees: rows });
  } catch (error) { return next(error); }
});

router.post("/employees", async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.employeeNumber || !body.legalName || !body.hireDate || !["hourly", "salary"].includes(body.payType)) return res.status(400).json({ message: "Les renseignements essentiels de l’employé sont invalides." });
    if (body.payType === "hourly" && Number(body.hourlyRate) <= 0) return res.status(400).json({ message: "Le taux horaire doit être supérieur à zéro." });
    if (body.payType === "salary" && Number(body.annualSalary) <= 0) return res.status(400).json({ message: "Le salaire annuel doit être supérieur à zéro." });
    const { firstName, lastName } = splitLegalName(body.legalName);
    const { rows } = await req.db.query(`INSERT INTO payroll_employees (organisation_id,user_id,employee_number,legal_name,legal_first_name,legal_last_name,hire_date,pay_type,hourly_rate,annual_salary,province,tax_profile,employment_status,pay_frequency,expense_account_id,payable_account_id,compensation_effective_from) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$7) RETURNING *`, [req.organisationId, body.userId || null, body.employeeNumber, body.legalName, firstName, lastName, body.hireDate, body.payType, body.hourlyRate || null, body.annualSalary || null, body.province || "QC", body.taxProfile || {}, body.employmentStatus || "active", body.payFrequency || "biweekly", body.expenseAccountId || null, body.payableAccountId || null]);
    await req.db.query(`INSERT INTO payroll_compensation_history (organisation_id,employee_id,effective_from,pay_type,hourly_rate,annual_salary,pay_frequency,reason,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [req.organisationId, rows[0].id, body.hireDate, body.payType, body.hourlyRate || null, body.annualSalary || null, body.payFrequency || "biweekly", "Embauche", req.user?.id || null]);
    return res.status(201).json({ employee: rows[0] });
  } catch (error) { return next(error); }
});

router.patch("/employees/:id", async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Employé");
    const body = req.body || {};
    const current = await req.db.query("SELECT * FROM payroll_employees WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [req.organisationId, id]);
    if (!current.rows[0]) return res.status(404).json({ message: "Employé introuvable." });
    const payType = body.payType || current.rows[0].pay_type;
    const hourlyRate = body.hourlyRate ?? current.rows[0].hourly_rate;
    const annualSalary = body.annualSalary ?? current.rows[0].annual_salary;
    if (payType === "hourly" && Number(hourlyRate) <= 0) return res.status(400).json({ message: "Le taux horaire doit être supérieur à zéro." });
    if (payType === "salary" && Number(annualSalary) <= 0) return res.status(400).json({ message: "Le salaire annuel doit être supérieur à zéro." });
    const effectiveFrom = body.effectiveFrom || new Date().toISOString().slice(0, 10);
    const { rows } = await req.db.query(`UPDATE payroll_employees SET legal_name=COALESCE($3,legal_name),employment_status=COALESCE($4,employment_status),termination_date=COALESCE($5,termination_date),pay_type=$6,hourly_rate=$7,annual_salary=$8,pay_frequency=COALESCE($9,pay_frequency),expense_account_id=COALESCE($10,expense_account_id),payable_account_id=COALESCE($11,payable_account_id),compensation_effective_from=$12,updated_at=NOW() WHERE organisation_id=$1 AND id=$2 RETURNING *`, [req.organisationId, id, body.legalName || null, body.employmentStatus || null, body.terminationDate || null, payType, payType === "hourly" ? hourlyRate : null, payType === "salary" ? annualSalary : null, body.payFrequency || null, body.expenseAccountId || null, body.payableAccountId || null, effectiveFrom]);
    await req.db.query(`INSERT INTO payroll_compensation_history (organisation_id,employee_id,effective_from,pay_type,hourly_rate,annual_salary,pay_frequency,reason,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [req.organisationId, id, effectiveFrom, payType, payType === "hourly" ? hourlyRate : null, payType === "salary" ? annualSalary : null, rows[0].pay_frequency, "Mise à jour de la rémunération", req.user?.id || null]);
    return res.json({ employee: rows[0] });
  } catch (error) { return next(error); }
});

router.get("/periods", async (req, res, next) => {
  try { const { rows } = await req.db.query("SELECT * FROM payroll_periods WHERE organisation_id=$1 ORDER BY period_start DESC", [req.organisationId]); return res.json({ periods: rows }); } catch (error) { return next(error); }
});
router.post("/periods", async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!["weekly", "biweekly", "semimonthly", "monthly"].includes(body.frequency) || !body.periodStart || !body.periodEnd || !body.payDate) return res.status(400).json({ message: "La fréquence et les dates de la période sont obligatoires." });
    const { rows } = await req.db.query(`INSERT INTO payroll_periods (organisation_id,frequency,period_start,period_end,pay_date) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.organisationId, body.frequency, body.periodStart, body.periodEnd, body.payDate]);
    return res.status(201).json({ period: rows[0] });
  } catch (error) { return next(error); }
});
router.post("/periods/:id/lock", async (req, res, next) => {
  try { const id = positiveId(req.params.id, "Période"); const { rows } = await req.db.query(`UPDATE payroll_periods SET status='locked',locked_at=NOW(),locked_by=$3 WHERE organisation_id=$1 AND id=$2 AND status='open' RETURNING *`, [req.organisationId, id, req.user?.id || null]); if (!rows[0]) return res.status(409).json({ message: "La période est introuvable ou déjà verrouillée." }); return res.json({ period: rows[0] }); } catch (error) { return next(error); }
});

router.get("/periods/:id/inputs", async (req, res, next) => {
  try { const id = positiveId(req.params.id, "Période"); const { rows } = await req.db.query(`SELECT i.*,e.employee_number,e.legal_name FROM payroll_variable_inputs i JOIN payroll_employees e ON e.id=i.employee_id AND e.organisation_id=i.organisation_id WHERE i.organisation_id=$1 AND i.payroll_period_id=$2 ORDER BY e.legal_name,i.id`, [req.organisationId, id]); return res.json({ inputs: rows }); } catch (error) { return next(error); }
});
router.post("/periods/:id/inputs", async (req, res, next) => {
  try {
    const periodId = positiveId(req.params.id, "Période"); const employeeId = positiveId(req.body?.employeeId, "Employé");
    const type = req.body?.inputType; const allowed = ["regular_hours", "overtime_hours", "paid_leave", "unpaid_leave", "bonus", "commission", "taxable_benefit", "reimbursement", "adjustment"];
    if (!allowed.includes(type) || (!Number.isFinite(Number(req.body?.quantity)) && !Number.isFinite(Number(req.body?.amount)))) return res.status(400).json({ message: "L’élément variable est invalide." });
    const { rows } = await req.db.query(`INSERT INTO payroll_variable_inputs (organisation_id,payroll_period_id,employee_id,input_type,quantity,amount,source_type,source_id,evidence,note,created_by) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 FROM payroll_periods p JOIN payroll_employees e ON e.organisation_id=p.organisation_id WHERE p.organisation_id=$1 AND p.id=$2 AND p.status='open' AND e.id=$3 RETURNING *`, [req.organisationId, periodId, employeeId, type, req.body.quantity ?? null, req.body.amount ?? null, req.body.sourceType || "manual", req.body.sourceId || crypto.randomUUID(), req.body.evidence || {}, req.body.note || null, req.user?.id || null]);
    if (!rows[0]) return res.status(409).json({ message: "La période doit être ouverte et l’employé doit appartenir à l’organisation." });
    return res.status(201).json({ input: rows[0] });
  } catch (error) { return next(error); }
});

router.get("/rulesets", async (req, res, next) => { try { const { rows } = await req.db.query(`SELECT id,version,province,effective_from,effective_to,status,checksum,created_at FROM payroll_rulesets WHERE organisation_id=$1 ORDER BY effective_from DESC`, [req.organisationId]); return res.json({ rulesets: rows }); } catch (error) { return next(error); } });
router.post("/rulesets", async (req, res, next) => { try { const body = req.body || {}; if (!body.version || !body.effectiveFrom || !body.rules || typeof body.rules !== "object") return res.status(400).json({ message: "Version, date d’effet et règles sont obligatoires." }); const checksum = checksumRules(body.rules); const { rows } = await req.db.query(`INSERT INTO payroll_rulesets (organisation_id,version,province,effective_from,effective_to,rules,checksum,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.organisationId, body.version, body.province || "QC", body.effectiveFrom, body.effectiveTo || null, body.rules, checksum, body.status || "draft", req.user?.id || null]); return res.status(201).json({ ruleset: rows[0] }); } catch (error) { return next(error); } });

router.get("/runs", async (req, res, next) => { try { const { rows } = await req.db.query(`SELECT r.*,rs.version AS ruleset_version FROM payroll_runs r LEFT JOIN payroll_rulesets rs ON rs.id=r.ruleset_id AND rs.organisation_id=r.organisation_id WHERE r.organisation_id=$1 ORDER BY r.period_end DESC`, [req.organisationId]); return res.json({ runs: rows }); } catch (error) { return next(error); } });
router.post("/runs", async (req, res, next) => { try { const body = req.body || {}; if (!body.periodStart || !body.periodEnd || !body.payDate || !body.rulesetId) return res.status(400).json({ message: "La période, la date de paiement et le jeu de règles sont obligatoires." }); const { rows } = await req.db.query(`INSERT INTO payroll_runs (organisation_id,period_start,period_end,pay_date,ruleset_id,ruleset_version) SELECT $1,$2,$3,$4,id,version FROM payroll_rulesets WHERE organisation_id=$1 AND id=$5 AND status='active' RETURNING *`, [req.organisationId, body.periodStart, body.periodEnd, body.payDate, body.rulesetId]); if (!rows[0]) return res.status(409).json({ message: "Le jeu de règles doit être actif." }); return res.status(201).json({ run: rows[0] }); } catch (error) { return next(error); } });
router.get("/runs/:id", async (req, res, next) => { try { const id = positiveId(req.params.id, "Cycle"); const run = await req.db.query(`SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2`, [req.organisationId, id]); if (!run.rows[0]) return res.status(404).json({ message: "Cycle de paie introuvable." }); const lines = await req.db.query(`SELECT l.*,e.employee_number,e.legal_name FROM payroll_run_lines l JOIN payroll_employees e ON e.id=l.employee_id AND e.organisation_id=l.organisation_id WHERE l.organisation_id=$1 AND l.payroll_run_id=$2 ORDER BY e.legal_name`, [req.organisationId, id]); return res.json({ run: run.rows[0], lines: lines.rows }); } catch (error) { return next(error); } });
router.post("/runs/:id/calculate", async (req, res, next) => { try { const result = await payrollService.calculateRun({ organisationId: req.organisationId, runId: positiveId(req.params.id, "Cycle"), entries: req.body?.entries || [], idempotencyKey: req.body?.idempotencyKey, createdBy: req.user?.id }); if (!result) return res.status(404).json({ message: "Cycle de paie introuvable." }); return res.status(result.duplicate ? 200 : 201).json(result); } catch (error) { return next(error); } });
for (const action of ["approve", "pay", "void"]) router.post(`/runs/:id/${action}`, async (req, res, next) => { try { const result = await payrollService.transitionRun({ organisationId: req.organisationId, runId: positiveId(req.params.id, "Cycle"), action, reason: req.body?.reason, idempotencyKey: req.body?.idempotencyKey, createdBy: req.user?.id }); if (!result) return res.status(404).json({ message: "Cycle de paie introuvable." }); return res.status(201).json(result); } catch (error) { return next(error); } });

router.get("/runs/:id/pay-stubs", async (req, res, next) => {
  try { const id = positiveId(req.params.id, "Cycle"); const run = await req.db.query("SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2", [req.organisationId, id]); if (!run.rows[0]) return res.status(404).json({ message: "Cycle de paie introuvable." }); const lines = await req.db.query(`SELECT l.*,e.employee_number,e.legal_name FROM payroll_run_lines l JOIN payroll_employees e ON e.id=l.employee_id AND e.organisation_id=l.organisation_id WHERE l.organisation_id=$1 AND l.payroll_run_id=$2 ORDER BY e.legal_name`, [req.organisationId, id]); return res.json({ payStubs: lines.rows.map((line) => buildPayStub({ run: run.rows[0], employee: line, line, canViewSensitive: true })) }); } catch (error) { return next(error); }
});
router.get("/runs/:id/register", async (req, res, next) => {
  try { const id = positiveId(req.params.id, "Cycle"); const run = await req.db.query("SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2", [req.organisationId, id]); if (!run.rows[0]) return res.status(404).json({ message: "Cycle de paie introuvable." }); const lines = await req.db.query(`SELECT l.*,e.employee_number,e.legal_name FROM payroll_run_lines l JOIN payroll_employees e ON e.id=l.employee_id AND e.organisation_id=l.organisation_id WHERE l.organisation_id=$1 AND l.payroll_run_id=$2 ORDER BY e.legal_name`, [req.organisationId, id]); return res.json({ register: buildPayrollRegister({ run: run.rows[0], lines: lines.rows }) }); } catch (error) { return next(error); }
});
router.post("/runs/:id/accounting-preview", async (req, res, next) => {
  try { const id = positiveId(req.params.id, "Cycle"); const { rows } = await req.db.query("SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2 AND status IN ('approved','paid')", [req.organisationId, id]); if (!rows[0]) return res.status(409).json({ message: "Le cycle doit être approuvé avant sa comptabilisation." }); return res.json({ journal: buildPayrollJournal({ run: rows[0], expenseAccountId: req.body?.expenseAccountId, payableAccountId: req.body?.payableAccountId, deductionLiabilityAccountId: req.body?.deductionLiabilityAccountId, contributionExpenseAccountId: req.body?.contributionExpenseAccountId, contributionLiabilityAccountId: req.body?.contributionLiabilityAccountId }) }); } catch (error) { return next(error); }
});
router.post("/runs/:id/post-accounting", async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Cycle");
    const { rows } = await req.db.query("SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2 AND status IN ('approved','paid')", [req.organisationId, id]);
    if (!rows[0]) return res.status(409).json({ message: "Le cycle doit être approuvé avant sa comptabilisation." });
    const result = await postPayrollJournal(req.db, {
      organisationId: req.organisationId,
      run: rows[0],
      userId: req.user?.id,
      expenseAccountId: req.body?.expenseAccountId,
      payableAccountId: req.body?.payableAccountId,
      deductionLiabilityAccountId: req.body?.deductionLiabilityAccountId,
      contributionExpenseAccountId: req.body?.contributionExpenseAccountId,
      contributionLiabilityAccountId: req.body?.contributionLiabilityAccountId,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

// Un cycle payé ne peut plus être annulé par /void (réservé à avant paiement) : sa
// correction renverse son écriture comptable publiée de façon non destructive (même
// gouvernance que /accounting/entries/:id/reverse) et marque le cycle 'corrected'
// plutôt que de le laisser 'paid' avec une écriture renversée en silence.
router.post("/runs/:id/correct", async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Cycle");
    const idempotencyKey = req.body?.idempotencyKey;
    if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
      return res.status(400).json({ message: "Une clé d’idempotence valide est obligatoire." });
    }

    const existing = await req.db.query(
      "SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2 AND correction_idempotency_key=$3",
      [req.organisationId, id, idempotencyKey],
    );
    if (existing.rows[0]) return res.status(200).json({ duplicate: true, run: existing.rows[0] });

    const { rows } = await req.db.query("SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [req.organisationId, id]);
    const run = rows[0];
    if (!run) return res.status(404).json({ message: "Cycle de paie introuvable." });
    if (run.status !== "paid") return res.status(409).json({ message: "Seul un cycle payé peut faire l’objet d’une correction." });
    if (!run.accounting_entry_id) return res.status(409).json({ message: "Ce cycle n’a pas d’écriture comptable publiée à renverser." });

    const reversal = await reversePostedEntry({
      organisationId: req.organisationId,
      entryId: run.accounting_entry_id,
      reversalDate: req.body?.reversalDate || new Date().toISOString().slice(0, 10),
      reason: req.body?.reason,
      idempotencyKey: `payroll-correction:${req.organisationId}:${run.id}:${idempotencyKey}`,
      confirmedByHuman: req.body?.confirmedByHuman,
      reversedBy: req.user?.id,
    });
    if (!reversal) return res.status(409).json({ message: "Écriture comptable introuvable pour ce cycle." });

    const { rows: corrected } = await req.db.query(
      `UPDATE payroll_runs SET status='corrected', corrected_at=NOW(), corrected_by=$3, correction_reason=$4, correction_idempotency_key=$5
       WHERE organisation_id=$1 AND id=$2 RETURNING *`,
      [req.organisationId, id, req.user?.id || null, req.body?.reason, idempotencyKey],
    );
    return res.status(201).json({ run: corrected[0], reversal });
  } catch (error) { return next(error); }
});

module.exports = router;
