function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function buildFinalPay({ regular = 0, vacation = 0, severance = 0, other = 0 }) {
  const values = [regular, vacation, severance, other].map(Number);
  if (values.some((value) => value < 0 || !Number.isFinite(value))) throw Object.assign(new Error('Les montants de fin d’emploi sont invalides.'), { statusCode: 400 });
  return { regular: money(regular), vacation: money(vacation), severance: money(severance), other: money(other), total: money(values.reduce((sum, value) => sum + value, 0)) };
}
function buildRoePayload({ employeeNumber, lastDayWorked, finalPayDate, reasonCode }) {
  if (!employeeNumber || !lastDayWorked || !finalPayDate || !reasonCode) throw Object.assign(new Error('Les renseignements du relevé d’emploi sont incomplets.'), { statusCode: 400 });
  return { employeeNumber, lastDayWorked, finalPayDate, reasonCode };
}
module.exports = { buildFinalPay, buildRoePayload };
