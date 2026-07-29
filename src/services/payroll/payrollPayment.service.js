const buildPaymentInstruction = ({ payrollRunId, employeeId, netCents, method = "direct_deposit", destinationToken }) => {
  if (!Number.isInteger(Number(netCents)) || Number(netCents) <= 0) throw new Error("PAYROLL_PAYMENT_AMOUNT_INVALID");
  if (!destinationToken) throw new Error("PAYROLL_PAYMENT_DESTINATION_REQUIRED");
  return Object.freeze({
    payrollRunId,
    employeeId,
    amountCents: Number(netCents),
    method,
    destinationToken,
    idempotencyKey: `payroll:${payrollRunId}:employee:${employeeId}`,
    status: "pending",
  });
};

const summarizePaymentBatch = (instructions = []) => Object.freeze({
  count: instructions.length,
  totalCents: instructions.reduce((sum, row) => sum + Number(row.amountCents || 0), 0),
  idempotencyKeys: instructions.map((row) => row.idempotencyKey),
});

module.exports = { buildPaymentInstruction, summarizePaymentBatch };
