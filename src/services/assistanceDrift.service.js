function assessRecommendationDrift(input = {}) {
  const acceptanceRate = Math.max(0, Math.min(1, Number(input.acceptanceRate || 0)));
  const harmfulRate = Math.max(0, Math.min(1, Number(input.harmfulRate || 0)));
  const ignoredRate = Math.max(0, Math.min(1, Number(input.ignoredRate || 0)));
  const confidence = Math.max(0, Math.min(1, Number(input.averageConfidence || 0)));
  let score = Math.round(harmfulRate * 60 + ignoredRate * 25 + Math.max(0, confidence - acceptanceRate) * 30);
  score = Math.max(0, Math.min(100, score));
  const status = score >= 70 ? 'stop' : score >= 40 ? 'watch' : 'stable';
  return { score, status, shouldStop: status === 'stop' };
}
module.exports = { assessRecommendationDrift };
