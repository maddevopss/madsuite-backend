const inspectPayrollRun = (run = {}) => {
  const anomalies = [];
  if (!run.organisationId) anomalies.push("MISSING_ORGANISATION");
  if (!run.period?.startDate || !run.period?.endDate) anomalies.push("MISSING_PERIOD");
  if (!Array.isArray(run.employees) || run.employees.length === 0) anomalies.push("EMPTY_PAYROLL_RUN");
  for (const employee of run.employees || []) {
    if (employee.grossCents - employee.deductionTotalCents !== employee.netCents) anomalies.push(`NET_MISMATCH:${employee.employeeId}`);
    if (employee.netCents < 0) anomalies.push(`NEGATIVE_NET:${employee.employeeId}`);
  }
  return Object.freeze({ healthy: anomalies.length === 0, anomalies: Object.freeze(anomalies) });
};

const buildPayrollAuditEvent = ({ action, actorId, organisationId, payrollRunId, metadata = {} }) => Object.freeze({
  category: "payroll",
  action,
  actorId,
  organisationId,
  payrollRunId,
  metadata: Object.freeze({ ...metadata }),
  occurredAt: new Date().toISOString(),
});

module.exports = { inspectPayrollRun, buildPayrollAuditEvent };
