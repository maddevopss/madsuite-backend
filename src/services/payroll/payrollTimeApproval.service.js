const approveTimeEntries = ({ entries = [], approverId, approvedAt = new Date().toISOString() }) => {
  if (!Number.isInteger(approverId)) throw new Error("PAYROLL_APPROVER_REQUIRED");
  const invalid = entries.filter((entry) => entry.deletedAt || entry.isBilled || !Number.isFinite(Number(entry.durationSeconds)));
  if (invalid.length) throw new Error("PAYROLL_TIME_ENTRY_INVALID");
  return entries.map((entry) => Object.freeze({
    ...entry,
    payrollApproved: true,
    payrollApprovedBy: approverId,
    payrollApprovedAt: approvedAt,
  }));
};

const totalApprovedSeconds = (entries = []) => entries
  .filter((entry) => entry.payrollApproved)
  .reduce((sum, entry) => sum + Number(entry.durationSeconds || 0), 0);

module.exports = { approveTimeEntries, totalApprovedSeconds };
