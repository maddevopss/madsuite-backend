function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function buildRemittance({ employeeAmount = 0, employerAmount = 0, dueDate }) {
  if (!dueDate) throw Object.assign(new Error('La date d’échéance est obligatoire.'), { statusCode: 400 });
  const employee = money(employeeAmount);
  const employer = money(employerAmount);
  if (employee < 0 || employer < 0) throw Object.assign(new Error('Les montants de remise ne peuvent pas être négatifs.'), { statusCode: 400 });
  return { employeeAmount: employee, employerAmount: employer, totalAmount: money(employee + employer), dueDate };
}
function isOverdue(remittance, today = new Date().toISOString().slice(0, 10)) {
  return !['paid','void'].includes(remittance.status) && remittance.dueDate < today;
}
module.exports = { buildRemittance, isOverdue };
