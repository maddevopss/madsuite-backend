const crypto = require("crypto");

function redactEmployee(employee, canViewSensitive) {
  if (canViewSensitive) return employee;
  return {
    id: employee.id,
    employee_number: employee.employee_number,
    legal_name: employee.legal_name,
    employment_status: employee.employment_status,
  };
}

function buildPayStub({ organisationId, run, line, employee, generatedBy }) {
  if (!organisationId || !run || !line || !employee) throw Object.assign(new Error("Données de talon incomplètes."), { statusCode: 400 });
  const payload = {
    organisationId,
    payrollRunId: run.id,
    employeeId: employee.id,
    employeeNumber: employee.employee_number,
    legalName: employee.legal_name,
    periodStart: run.period_start,
    periodEnd: run.period_end,
    payDate: run.pay_date,
    grossPay: Number(line.gross_pay || 0),
    deductions: line.deductions || {},
    employerContributions: line.employer_contributions || {},
    netPay: Number(line.net_pay || 0),
    rulesetVersion: line.ruleset_version,
    calculationChecksum: line.calculation_checksum,
    generatedBy,
  };
  return { ...payload, documentChecksum: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}

function buildPayrollRegister({ organisationId, run, lines }) {
  const rows = lines.map((line) => ({
    employeeId: line.employee_id,
    employeeNumber: line.employee_number,
    legalName: line.legal_name,
    grossPay: Number(line.gross_pay || 0),
    netPay: Number(line.net_pay || 0),
  }));
  return {
    organisationId,
    payrollRunId: run.id,
    status: run.status,
    rows,
    totals: run.totals,
    exportedAt: new Date().toISOString(),
  };
}

module.exports = { redactEmployee, buildPayStub, buildPayrollRegister };
