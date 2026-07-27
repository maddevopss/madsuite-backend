function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function reconcilePayroll({ expectedNet, depositedNet, remittedTotal = 0, tolerance = 0.01 }) {
  const expected = roundMoney(expectedNet);
  const deposited = roundMoney(depositedNet);
  const variance = roundMoney(deposited - expected);
  const absoluteVariance = Math.abs(variance);
  const status = absoluteVariance <= tolerance ? 'balanced' : absoluteVariance <= 5 ? 'warning' : 'blocked';
  const findings = [];
  if (status !== 'balanced') findings.push({ code: 'NET_DEPOSIT_VARIANCE', expected, deposited, variance });
  if (Number(remittedTotal) < 0) findings.push({ code: 'INVALID_REMITTANCE_TOTAL' });
  return { expectedNet: expected, depositedNet: deposited, remittedTotal: roundMoney(remittedTotal), variance, status, findings };
}

module.exports = { reconcilePayroll };
