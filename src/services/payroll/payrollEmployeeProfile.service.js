const normalizePayrollEmployeeProfile = (input = {}) => {
  if (!Number.isInteger(input.organisationId) || !Number.isInteger(input.userId)) {
    throw new Error("PAYROLL_EMPLOYEE_SCOPE_REQUIRED");
  }
  if (!input.employmentType || !["hourly", "salary"].includes(input.employmentType)) {
    throw new Error("PAYROLL_EMPLOYMENT_TYPE_INVALID");
  }
  return Object.freeze({
    organisationId: input.organisationId,
    userId: input.userId,
    employeeNumber: String(input.employeeNumber || input.userId),
    employmentType: input.employmentType,
    provinceCode: String(input.provinceCode || "QC").toUpperCase(),
    hireDate: input.hireDate,
    terminationDate: input.terminationDate || null,
    active: input.active !== false,
  });
};

const assertSameOrganisation = (profile, organisationId) => {
  if (profile.organisationId !== organisationId) throw new Error("PAYROLL_CROSS_ORGANISATION_DENIED");
  return true;
};

module.exports = { normalizePayrollEmployeeProfile, assertSameOrganisation };
