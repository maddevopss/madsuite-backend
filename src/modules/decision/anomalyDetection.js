function detectAnomaly({ value = 0, mean = 0, standardDeviation = 0, threshold = 3 }) {
  if (Number(standardDeviation) <= 0) return { anomalous: false, zScore: null };
  const zScore = (Number(value) - Number(mean)) / Number(standardDeviation);
  return { anomalous: Math.abs(zScore) >= Number(threshold), zScore };
}

module.exports = { detectAnomaly };
