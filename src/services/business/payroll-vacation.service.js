function roundMoney(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function accrueVacation(grossPay, ratePercent = 4) {
  if (Number(grossPay) < 0 || Number(ratePercent) < 0) throw Object.assign(new Error('Les valeurs de vacances sont invalides.'), { statusCode: 400 });
  return roundMoney(Number(grossPay) * Number(ratePercent) / 100);
}
function availableVacation(accrued, paid) { return roundMoney(Number(accrued || 0) - Number(paid || 0)); }
module.exports = { accrueVacation, availableVacation };
