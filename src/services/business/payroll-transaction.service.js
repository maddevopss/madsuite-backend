const crypto = require("crypto");
const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");
const { calculateGrossPay, roundMoney } = require("./payroll-gross-calculation.service");
const { calculateNetPay } = require("./payroll-deductions.service");
const { assertCanApprove } = require("./payroll-approval-policy.service");

const CALCULATE_POLICY = "payroll.run.calculate@1";
const APPROVE_POLICY = "payroll.run.approve@1";
const PAY_POLICY = "payroll.run.pay@1";
const VOID_POLICY = "payroll.run.void@1";

function validIdempotency(value) { return Boolean(value && String(value).trim().length >= 8); }
function money(value) { const n = Number(value); return Number.isFinite(n) ? roundMoney(n) : null; }
function checksum(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function mapRules(value, kind) {
  if (Array.isArray(value)) return value;
  return Object.entries(value || {}).map(([code, rate]) => ({ code, rate, version: kind }));
}
function legacyEntriesToInputs(entry = {}) {
  return [
    { input_type: "regular_hours", quantity: Number(entry.regularHours || 0), amount: null },
    { input_type: "overtime_hours", quantity: Number(entry.overtimeHours || 0), amount: null },
    { input_type: "bonus", quantity: null, amount: Number(entry.bonus || 0) },
    { input_type: "commission", quantity: null, amount: Number(entry.commission || 0) },
    { input_type: "taxable_benefit", quantity: null, amount: Number(entry.taxableBenefit || 0) },
    { input_type: "reimbursement", quantity: null, amount: Number(entry.reimbursement || 0) },
    { input_type: "adjustment", quantity: null, amount: Number(entry.adjustment || 0) },
  ].filter((row) => Number(row.quantity || row.amount || 0) !== 0);
}

registerPolicy("payroll.run.calculate", "1", ({ input, idempotencyKey }) => {
  if (!input?.runId) return { allowed: false, statusCode: 400, code: "payroll.run_required", reason: "Un cycle de paie est requis." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "payroll.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  return { allowed: true, code: "payroll.calculate.valid" };
});
registerPolicy("payroll.run.approve", "1", ({ input }) => input?.runId ? { allowed: true } : { allowed: false, statusCode: 400, reason: "Un cycle de paie est requis." });
registerPolicy("payroll.run.pay", "1", ({ input, idempotencyKey }) => (!input?.runId || !validIdempotency(idempotencyKey)) ? { allowed: false, statusCode: 400, reason: "Cycle et clé d’idempotence requis." } : { allowed: true });
registerPolicy("payroll.run.void", "1", ({ input, idempotencyKey }) => (!input?.runId || !validIdempotency(idempotencyKey) || !String(input.reason || "").trim()) ? { allowed: false, statusCode: 400, reason: "Cycle, clé d’idempotence et raison sont requis." } : { allowed: true });

function computeEmployeeLine(employee, inputs, rules, payDate) {
  const normalizedInputs = Array.isArray(inputs) ? inputs : legacyEntriesToInputs(inputs || {});
  const gross = calculateGrossPay({ employee, inputs: normalizedInputs, rules });
  const net = calculateNetPay({
    grossPay: gross.grossPay,
    reimbursements: gross.reimbursements,
    payDate,
    employeeDeductions: mapRules(rules.employeeDeductions, rules.version || "ruleset"),
    employerContributions: mapRules(rules.employerContributions, rules.version || "ruleset"),
    voluntaryDeductions: mapRules(rules.voluntaryDeductions, rules.version || "ruleset"),
  });
  return {
    regularHours: Number(gross.trace.regularHours || 0),
    overtimeHours: Number(gross.trace.overtimeHours || 0),
    grossPay: gross.grossPay,
    reimbursements: gross.reimbursements,
    deductions: Object.fromEntries([...net.statutoryDeductions, ...net.voluntaryDeductions].map((row) => [row.code, row.amount])),
    employerContributions: Object.fromEntries(net.employerContributions.map((row) => [row.code, row.amount])),
    netPay: net.netPay,
    explanation: { gross, net },
  };
}

async function calculateRun({ organisationId, runId, entries = [], idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "payroll.run.calculate", organisationId: organisationValue(organisationId), actorUserId: createdBy,
    idempotencyKey, policies: [CALCULATE_POLICY], input: { runId, entries },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId, input }) => {
      const { rows } = await client.query(`SELECT r.*, rs.rules, rs.version ruleset_version FROM payroll_runs r JOIN payroll_rulesets rs ON rs.id=r.ruleset_id AND rs.organisation_id=r.organisation_id WHERE r.organisation_id=$1 AND r.id=$2 FOR UPDATE`, [orgId, input.runId]);
      const run = rows[0]; if (!run) return null;
      if (run.status === "calculated" && run.idempotency_key === idempotencyKey) return { duplicate: true, run };
      if (run.status !== "draft") throw Object.assign(new Error("Seul un cycle en brouillon peut être calculé."), { statusCode: 409 });

      const employees = await client.query(`SELECT * FROM payroll_employees WHERE organisation_id=$1 AND is_active=TRUE AND hire_date <= $2 AND (termination_date IS NULL OR termination_date >= $3)`, [orgId, run.period_end, run.period_start]);
      // Préfère la référence explicite payroll_period_id (créée via /periods/:id/runs) ;
      // se rabat sur l'égalité de dates pour les cycles créés par l'ancienne route POST /runs.
      const storedInputs = run.payroll_period_id
        ? await client.query(`SELECT i.* FROM payroll_variable_inputs i WHERE i.organisation_id=$1 AND i.payroll_period_id=$2 ORDER BY i.employee_id,i.id`, [orgId, run.payroll_period_id])
        : await client.query(`SELECT i.* FROM payroll_variable_inputs i JOIN payroll_periods p ON p.id=i.payroll_period_id AND p.organisation_id=i.organisation_id WHERE i.organisation_id=$1 AND p.period_start=$2 AND p.period_end=$3 ORDER BY i.employee_id,i.id`, [orgId, run.period_start, run.period_end]);
      const byEmployee = new Map();
      for (const row of storedInputs.rows) {
        const key = Number(row.employee_id); const list = byEmployee.get(key) || []; list.push(row); byEmployee.set(key, list);
      }
      for (const entry of input.entries || []) {
        const key = Number(entry.employeeId); const list = byEmployee.get(key) || []; list.push(...legacyEntriesToInputs(entry)); byEmployee.set(key, list);
      }

      let gross = 0, net = 0, deductions = 0, employer = 0, reimbursements = 0;
      for (const employee of employees.rows) {
        const source = byEmployee.get(Number(employee.id)) || [];
        const line = computeEmployeeLine(employee, source, { ...run.rules, version: run.ruleset_version }, run.pay_date);
        gross += line.grossPay; net += line.netPay; reimbursements += line.reimbursements;
        deductions += Object.values(line.deductions).reduce((a, b) => a + Number(b), 0);
        employer += Object.values(line.employerContributions).reduce((a, b) => a + Number(b), 0);
        const trace = { employeeId: employee.id, rulesetVersion: run.ruleset_version, source, result: line };
        await client.query(`INSERT INTO payroll_run_lines (organisation_id,payroll_run_id,employee_id,regular_hours,overtime_hours,gross_pay,deductions,employer_contributions,net_pay,calculation_trace,source_snapshot,ruleset_version,calculation_checksum) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (organisation_id,payroll_run_id,employee_id) DO UPDATE SET regular_hours=EXCLUDED.regular_hours,overtime_hours=EXCLUDED.overtime_hours,gross_pay=EXCLUDED.gross_pay,deductions=EXCLUDED.deductions,employer_contributions=EXCLUDED.employer_contributions,net_pay=EXCLUDED.net_pay,calculation_trace=EXCLUDED.calculation_trace,source_snapshot=EXCLUDED.source_snapshot,ruleset_version=EXCLUDED.ruleset_version,calculation_checksum=EXCLUDED.calculation_checksum`, [orgId, run.id, employee.id, line.regularHours, line.overtimeHours, line.grossPay, JSON.stringify(line.deductions), JSON.stringify(line.employerContributions), line.netPay, JSON.stringify(trace), JSON.stringify(source), run.ruleset_version, checksum(trace)]);
      }
      if (!employees.rows.length) throw Object.assign(new Error("Aucun employé actif pour cette période."), { statusCode: 409 });

      const totals = { gross: money(gross), reimbursements: money(reimbursements), deductions: money(deductions), employerContributions: money(employer), net: money(net) };
      const updated = await client.query(`UPDATE payroll_runs SET status='calculated',totals=$1,idempotency_key=$2,calculated_at=NOW(),calculated_by=$3,ct_mad_transaction_id=$4,correlation_id=$5 WHERE organisation_id=$6 AND id=$7 RETURNING *`, [JSON.stringify(totals), idempotencyKey, actorUserId || null, transactionId, correlationId, orgId, run.id]);
      await client.query(`UPDATE payroll_periods SET status='locked',locked_at=NOW(),locked_by=$1 WHERE organisation_id=$2 AND period_start=$3 AND period_end=$4 AND status='open'`, [actorUserId, orgId, run.period_start, run.period_end]);
      const event = await appendEvent(client, { organisationId: orgId, eventType: "payroll.run.calculated", aggregateType: "payroll_run", aggregateId: run.id, actorUserId, correlationId, payload: { totals, rulesetVersion: run.ruleset_version } });
      const trust = await persistTrustAssessment(client, { organisationId: orgId, transactionId, correlationId, checks: [{ code: "payroll.ruleset_versioned", passed: Boolean(run.ruleset_version), evidence: [{ version: run.ruleset_version }] }, { code: "payroll.lines_calculated", passed: employees.rows.length > 0, evidence: [{ employeeCount: employees.rows.length }] }, { code: "payroll.inputs_locked", passed: true, evidence: [{ periodStart: run.period_start, periodEnd: run.period_end }] }] });
      const graph = await persistGraphEdges(client, { organisationId: orgId, transactionId, correlationId, edges: [{ from: { type: "payroll_run", id: run.id }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } }, { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: "payroll_run", id: run.id }, provenance: { transactionId } }] });
      return { duplicate: false, run: updated.rows[0], event, trust, graph };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function transitionRun({ organisationId, runId, action, reason, idempotencyKey, createdBy, skipMultiApproverGate }) {
  const policy = action === "approve" ? APPROVE_POLICY : action === "pay" ? PAY_POLICY : VOID_POLICY;
  const tx = await executeTransaction({ type: `payroll.run.${action}`, organisationId: organisationValue(organisationId), actorUserId: createdBy, idempotencyKey, policies: [policy], input: { runId, reason }, execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
    const { rows } = await client.query(`SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE`, [orgId, runId]); const run = rows[0]; if (!run) return null;
    const expected = action === "approve" ? "calculated" : action === "pay" ? "approved" : null;
    if (expected && run.status !== expected) throw Object.assign(new Error(`Le cycle doit être ${expected}.`), { statusCode: 409 });
    // Un admin pouvait auparavant préparer (calculer) ET approuver le même
    // cycle de paie sans aucun contrôle de séparation des tâches. On refuse
    // désormais l'auto-approbation en comparant le préparateur enregistré
    // (calculated_by) à l'approbateur courant, via la logique déjà conçue
    // (mais jusqu'ici jamais câblée) de payroll-approval-policy.service.js.
    if (action === "approve") {
      assertCanApprove({ preparedBy: run.calculated_by, approverId: actorUserId });
      // Si l'organisation a activé une politique d'approbation
      // multi-approbateurs (payroll_approval_policies), l'approbation
      // directe en un seul appel est refusée : elle doit passer par
      // POST /runs/:id/approval-decisions, qui appelle cette même fonction
      // avec skipMultiApproverGate une fois le seuil atteint.
      if (!skipMultiApproverGate) {
        const activePolicy = await client.query(
          `SELECT id FROM payroll_approval_policies WHERE organisation_id=$1 AND code='payroll_run_approval' AND active=TRUE`,
          [orgId],
        );
        if (activePolicy.rows[0]) {
          throw Object.assign(new Error("Ce cycle exige une approbation multi-approbateurs : utilisez POST /runs/:id/approval-decisions."), { statusCode: 409 });
        }
      }
    }
    if (action === "void" && run.status === "paid") throw Object.assign(new Error("Un cycle payé doit être renversé par un processus de paiement distinct."), { statusCode: 409 });
    const status = action === "approve" ? "approved" : action === "pay" ? "paid" : "void";
    // $5 (reason) doit être référencé dans les trois branches : sinon Postgres
    // ne peut pas déterminer son type de paramètre puisque $6/$7 sont utilisés
    // plus loin ("could not determine data type of parameter $5").
    const fields = action === "approve" ? "approved_at=NOW(),approved_by=$1,void_reason=COALESCE($5,void_reason)" : action === "pay" ? "paid_at=NOW(),paid_by=$1,void_reason=COALESCE($5,void_reason)" : "voided_at=NOW(),voided_by=$1,void_reason=$5";
    const updated = await client.query(`UPDATE payroll_runs SET status=$2,${fields},ct_mad_transaction_id=$3,correlation_id=$4 WHERE organisation_id=$6 AND id=$7 RETURNING *`, [actorUserId, status, transactionId, correlationId, reason || null, orgId, runId]);
    const event = await appendEvent(client, { organisationId: orgId, eventType: `payroll.run.${status}`, aggregateType: "payroll_run", aggregateId: runId, actorUserId, correlationId, payload: { reason: reason || null, totals: run.totals } });
    const trust = await persistTrustAssessment(client, { organisationId: orgId, transactionId, correlationId, checks: [{ code: `payroll.${status}`, passed: updated.rows[0].status === status, evidence: [{ status }] }] });
    return { run: updated.rows[0], event, trust };
  }});
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

module.exports = { CALCULATE_POLICY, APPROVE_POLICY, PAY_POLICY, VOID_POLICY, validIdempotency, money, checksum, computeEmployeeLine, calculateRun, transitionRun };