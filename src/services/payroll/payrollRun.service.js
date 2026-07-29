const TRANSITIONS = Object.freeze({ draft: ["calculated", "cancelled"], calculated: ["approved", "draft"], approved: ["paid", "cancelled"], paid: [], cancelled: [] });

const transitionPayrollRun = (run, nextStatus, actorId, at = new Date().toISOString()) => {
  if (!TRANSITIONS[run.status]?.includes(nextStatus)) throw new Error("PAYROLL_RUN_TRANSITION_INVALID");
  return Object.freeze({ ...run, status: nextStatus, updatedBy: actorId, updatedAt: at });
};

const calculateNetPay = ({ grossCents, deductionTotalCents = 0, reimbursementsCents = 0 }) => {
  const netCents = Number(grossCents) - Number(deductionTotalCents) + Number(reimbursementsCents);
  if (!Number.isInteger(netCents) || netCents < 0) throw new Error("PAYROLL_NET_PAY_INVALID");
  return netCents;
};

const summarizePayrollRun = (employees = []) => Object.freeze({
  employeeCount: employees.length,
  grossCents: employees.reduce((sum, row) => sum + Number(row.grossCents || 0), 0),
  deductionsCents: employees.reduce((sum, row) => sum + Number(row.deductionTotalCents || 0), 0),
  netCents: employees.reduce((sum, row) => sum + Number(row.netCents || 0), 0),
});

module.exports = { transitionPayrollRun, calculateNetPay, summarizePayrollRun };
