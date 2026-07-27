function calculateSupplierRisk({ financialScore = 0, complianceScore = 0, operationalScore = 0 }) {
  const weightedStrength = (Number(financialScore) * 0.3) + (Number(complianceScore) * 0.4) + (Number(operationalScore) * 0.3);
  const riskScore = Number((100 - weightedStrength).toFixed(2));
  const status = riskScore <= 20 ? 'approved' : riskScore <= 45 ? 'conditional' : 'rejected';
  return { riskScore, status };
}
module.exports = { calculateSupplierRisk };