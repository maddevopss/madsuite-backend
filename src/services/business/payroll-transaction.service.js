const crypto = require("crypto");
const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");

const CALCULATE_POLICY = "payroll.run.calculate@1";
const APPROVE_POLICY = "payroll.run.approve@1";
const PAY_POLICY = "payroll.run.pay@1";
const VOID_POLICY = "payroll.run.void@1";

function validIdempotency(value) { return Boolean(value && String(value).trim().length >= 8); }
function money(value) { const n = Number(value); return Number.isFinite(n) ? Number(n.toFixed(2)) : null; }
function checksum(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

registerPolicy("payroll.run.calculate", "1", ({ input, idempotencyKey }) => {
  if (!input?.runId) return { allowed: false, statusCode: 400, code: "payroll.run_required", reason: "Un cycle de paie est requis." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "payroll.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  return { allowed: true, code: "payroll.calculate.valid" };
});
registerPolicy("payroll.run.approve", "1", ({ input }) => input?.runId ? { allowed: true } : { allowed: false, statusCode: 400, reason: "Un cycle de paie est requis." });
registerPolicy("payroll.run.pay", "1", ({ input, idempotencyKey }) => {
  if (!input?.runId || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Cycle et clé d’idempotence requis." };
  return { allowed: true };
});
registerPolicy("payroll.run.void", "1", ({ input, idempotencyKey }) => {
  if (!input?.runId || !validIdempotency(idempotencyKey) || !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, reason: "Cycle, clé d’idempotence et raison sont requis." };
  return { allowed: true };
});

function computeEmployeeLine(employee, input, rules) {
  const regularHours = money(input.regularHours || 0);
  const overtimeHours = money(input.overtimeHours || 0);
  const gross = employee.pay_type === "salary"
    ? money((Number(employee.annual_salary || 0) / Number(rules.payPeriodsPerYear || 26)))
    : money((regularHours * Number(employee.hourly_rate || 0)) + (overtimeHours * Number(employee.hourly_rate || 0) * Number(rules.overtimeMultiplier || 1.5)));
  const deductions = {};
  let deductionTotal = 0;
  for (const [code, rate] of Object.entries(rules.employeeDeductions || {})) {
    const amount = money(gross * Number(rate)); deductions[code] = amount; deductionTotal += amount;
  }
  const employerContributions = {};
  for (const [code, rate] of Object.entries(rules.employerContributions || {})) employerContributions[code] = money(gross * Number(rate));
  const net = money(gross - deductionTotal);
  return { regularHours, overtimeHours, grossPay: gross, deductions, employerContributions, netPay: net };
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
      const employees = await client.query(`SELECT * FROM payroll_employees WHERE organisation_id=$1 AND is_active=TRUE`, [orgId]);
      const byEmployee = new Map(input.entries.map((e) => [Number(e.employeeId), e]));
      let gross = 0, net = 0, deductions = 0, employer = 0;
      for (const employee of employees.rows) {
        const source = byEmployee.get(Number(employee.id)) || {};
        const line = computeEmployeeLine(employee, source, run.rules);
        gross += line.grossPay; net += line.netPay;
        deductions += Object.values(line.deductions).reduce((a, b) => a + Number(b), 0);
        employer += Object.values(line.employerContributions).reduce((a, b) => a + Number(b), 0);
        const trace = { employeeId: employee.id, rulesetVersion: run.ruleset_version, source, result: line };
        await client.query(`INSERT INTO payroll_run_lines (organisation_id,payroll_run_id,employee_id,regular_hours,overtime_hours,gross_pay,deductions,employer_contributions,net_pay,calculation_trace,source_snapshot,ruleset_version,calculation_checksum) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (organisation_id,payroll_run_id,employee_id) DO UPDATE SET regular_hours=EXCLUDED.regular_hours,overtime_hours=EXCLUDED.overtime_hours,gross_pay=EXCLUDED.gross_pay,deductions=EXCLUDED.deductions,employer_contributions=EXCLUDED.employer_contributions,net_pay=EXCLUDED.net_pay,calculation_trace=EXCLUDED.calculation_trace,source_snapshot=EXCLUDED.source_snapshot,ruleset_version=EXCLUDED.ruleset_version,calculation_checksum=EXCLUDED.calculation_checksum`, [orgId, run.id, employee.id, line.regularHours, line.overtimeHours, line.grossPay, line.deductions, line.employerContributions, line.netPay, trace, source, run.ruleset_version, checksum(trace)]);
      }
      const totals = { gross: money(gross), deductions: money(deductions), employerContributions: money(employer), net: money(net) };
      const updated = await client.query(`UPDATE payroll_runs SET status='calculated',totals=$1,idempotency_key=$2,calculated_at=NOW(),ct_mad_transaction_id=$3,correlation_id=$4 WHERE organisation_id=$5 AND id=$6 RETURNING *`, [totals, idempotencyKey, transactionId, correlationId, orgId, run.id]);
      const event = await appendEvent(client, { organisationId: orgId, eventType: "payroll.run.calculated", aggregateType: "payroll_run", aggregateId: run.id, actorUserId, correlationId, payload: { totals, rulesetVersion: run.ruleset_version } });
      const trust = await persistTrustAssessment(client, { organisationId: orgId, transactionId, correlationId, checks: [{ code: "payroll.ruleset_versioned", passed: Boolean(run.ruleset_version), evidence: [{ version: run.ruleset_version }] }, { code: "payroll.lines_calculated", passed: employees.rows.length > 0, evidence: [{ employeeCount: employees.rows.length }] }] });
      const graph = await persistGraphEdges(client, { organisationId: orgId, transactionId, correlationId, edges: [{ from: { type: "payroll_run", id: run.id }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } }, { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: "payroll_run", id: run.id }, provenance: { transactionId } }] });
      return { duplicate: false, run: updated.rows[0], event, trust, graph };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function transitionRun({ organisationId, runId, action, reason, idempotencyKey, createdBy }) {
  const policy = action === "approve" ? APPROVE_POLICY : action === "pay" ? PAY_POLICY : VOID_POLICY;
  const tx = await executeTransaction({ type: `payroll.run.${action}`, organisationId: organisationValue(organisationId), actorUserId: createdBy, idempotencyKey, policies: [policy], input: { runId, reason }, execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
    const { rows } = await client.query(`SELECT * FROM payroll_runs WHERE organisation_id=$1 AND id=$2 FOR UPDATE`, [orgId, runId]); const run = rows[0]; if (!run) return null;
    const expected = action === "approve" ? "calculated" : action === "pay" ? "approved" : null;
    if (expected && run.status !== expected) throw Object.assign(new Error(`Le cycle doit être ${expected}.`), { statusCode: 409 });
    if (action === "void" && run.status === "paid") throw Object.assign(new Error("Un cycle payé doit être renversé par un processus de paiement distinct."), { statusCode: 409 });
    const status = action === "approve" ? "approved" : action === "pay" ? "paid" : "void";
    const fields = action === "approve" ? "approved_at=NOW(),approved_by=$1" : action === "pay" ? "paid_at=NOW(),paid_by=$1" : "voided_at=NOW(),voided_by=$1,void_reason=$5";
    const updated = await client.query(`UPDATE payroll_runs SET status=$2,${fields},ct_mad_transaction_id=$3,correlation_id=$4 WHERE organisation_id=$6 AND id=$7 RETURNING *`, [actorUserId, status, transactionId, correlationId, reason || null, orgId, runId]);
    const event = await appendEvent(client, { organisationId: orgId, eventType: `payroll.run.${status}`, aggregateType: "payroll_run", aggregateId: runId, actorUserId, correlationId, payload: { reason: reason || null, totals: run.totals } });
    const trust = await persistTrustAssessment(client, { organisationId: orgId, transactionId, correlationId, checks: [{ code: `payroll.${status}`, passed: updated.rows[0].status === status, evidence: [{ status }] }] });
    return { run: updated.rows[0], event, trust };
  }});
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

module.exports = { CALCULATE_POLICY, APPROVE_POLICY, PAY_POLICY, VOID_POLICY, validIdempotency, money, checksum, computeEmployeeLine, calculateRun, transitionRun };
