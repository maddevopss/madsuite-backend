const ALLOWED_STATUSES = new Set(['draft', 'active', 'leave', 'terminated', 'archived']);

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function normalizeOptionalText(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeEmployeeRecord(input = {}) {
  const employeeNumber = String(input.employeeNumber || '').trim();
  const legalFirstName = String(input.legalFirstName || '').trim();
  const legalLastName = String(input.legalLastName || '').trim();
  const employmentStatus = String(input.employmentStatus || 'active').trim();

  if (!employeeNumber) throw invalid('Le numéro d’employé est obligatoire.');
  if (!legalFirstName) throw invalid('Le prénom légal est obligatoire.');
  if (!legalLastName) throw invalid('Le nom de famille légal est obligatoire.');
  if (!ALLOWED_STATUSES.has(employmentStatus)) throw invalid('Le statut d’emploi est invalide.');

  const hireDate = normalizeOptionalText(input.hireDate);
  const terminationDate = normalizeOptionalText(input.terminationDate);

  if (hireDate && terminationDate && new Date(terminationDate) < new Date(hireDate)) {
    throw invalid('La date de fin d’emploi ne peut pas précéder la date d’embauche.');
  }

  return {
    employeeNumber,
    legalFirstName,
    legalLastName,
    preferredName: normalizeOptionalText(input.preferredName),
    email: normalizeOptionalText(input.email)?.toLowerCase() || null,
    phone: normalizeOptionalText(input.phone),
    employmentStatus,
    hireDate,
    terminationDate,
    departmentCode: normalizeOptionalText(input.departmentCode),
    positionTitle: normalizeOptionalText(input.positionTitle),
    managerEmployeeId: input.managerEmployeeId == null ? null : Number(input.managerEmployeeId),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata
      : {},
  };
}

function canParticipateInPayroll(employee = {}) {
  return employee.employmentStatus === 'active' && !employee.archivedAt;
}

module.exports = {
  ALLOWED_STATUSES,
  normalizeEmployeeRecord,
  canParticipateInPayroll,
};
