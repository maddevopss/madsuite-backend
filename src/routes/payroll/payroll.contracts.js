const parseInteger = (value, code) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
};

const parsePayrollRunRequest = (body = {}) => {
  if (!body.periodStart || !body.periodEnd || !body.payDate) throw new Error("PAYROLL_PERIOD_REQUIRED");
  return Object.freeze({
    periodStart: body.periodStart,
    periodEnd: body.periodEnd,
    payDate: body.payDate,
    scheduleId: parseInteger(body.scheduleId, "PAYROLL_SCHEDULE_ID_INVALID"),
    employeeIds: Object.freeze((body.employeeIds || []).map((id) => parseInteger(id, "PAYROLL_EMPLOYEE_ID_INVALID"))),
  });
};

const parsePayrollActionRequest = (body = {}, params = {}) => Object.freeze({
  payrollRunId: parseInteger(params.id, "PAYROLL_RUN_ID_INVALID"),
  reason: body.reason ? String(body.reason).trim() : null,
});

module.exports = { parsePayrollRunRequest, parsePayrollActionRequest };
