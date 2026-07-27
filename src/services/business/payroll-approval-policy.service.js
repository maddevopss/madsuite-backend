function forbidden(message) {
  return Object.assign(new Error(message), { statusCode: 403 });
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function assertPreparationComplete({ run, employees = [], inputs = [] }) {
  if (!run) throw conflict("Cycle de paie introuvable.");
  if (!employees.length) throw conflict("Aucun employé admissible pour ce cycle.");
  const employeeIds = new Set(employees.map((employee) => Number(employee.id)));
  const invalid = inputs.find((input) => !employeeIds.has(Number(input.employee_id)) || !input.source_type || !input.source_id);
  if (invalid) throw conflict("Un élément variable est incomplet ou ne correspond pas à un employé admissible.");
  return true;
}

function assertCanApprove({ preparedBy, approverId, approverRoles = [] }) {
  if (!approverRoles.includes("payroll_approver") && !approverRoles.includes("admin")) {
    throw forbidden("Le rôle d’approbateur de paie est obligatoire.");
  }
  if (preparedBy && Number(preparedBy) === Number(approverId)) {
    throw forbidden("Le préparateur ne peut pas approuver son propre cycle de paie.");
  }
  return true;
}

module.exports = { assertPreparationComplete, assertCanApprove };
