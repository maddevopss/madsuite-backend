function forbidden(message) {
  return Object.assign(new Error(message), { statusCode: 403 });
}

function canViewSensitivePayroll({ actorUserId, employeeUserId, roles = [] }) {
  return Number(actorUserId) === Number(employeeUserId)
    || roles.includes("payroll_approver")
    || roles.includes("admin");
}

function redactPayStub(payStub, canViewSensitive) {
  if (canViewSensitive) return payStub;
  if (!payStub) return payStub;
  const { deductions, taxProfile, banking, ...publicFields } = payStub;
  return {
    ...publicFields,
    deductions: undefined,
    taxProfile: undefined,
    banking: undefined,
    redacted: true,
  };
}

function assertCanExportRegister(roles = []) {
  if (!roles.includes("payroll_approver") && !roles.includes("admin")) {
    throw forbidden("Le registre de paie exige un rôle autorisé.");
  }
  return true;
}

module.exports = { canViewSensitivePayroll, redactPayStub, assertCanExportRegister };
