const createAdjustment = ({ originalPayrollItemId, employeeId, amountCents, reason, createdBy }) => {
  if (!originalPayrollItemId || !employeeId || !reason || !Number.isInteger(Number(amountCents)) || Number(amountCents) === 0) {
    throw new Error("PAYROLL_ADJUSTMENT_INVALID");
  }
  return Object.freeze({
    originalPayrollItemId,
    employeeId,
    amountCents: Number(amountCents),
    reason,
    createdBy,
    idempotencyKey: `payroll-adjustment:${originalPayrollItemId}:${employeeId}:${Number(amountCents)}`,
    status: "pending",
  });
};

const reversePayrollItem = (item, reason, actorId) => Object.freeze({
  ...item,
  amountCents: -Number(item.amountCents),
  reversalOf: item.id,
  reversalReason: reason,
  createdBy: actorId,
});

module.exports = { createAdjustment, reversePayrollItem };
