function scoreOperationalReadiness({ completionRate = 0, exceptionCount = 0 } = {}) {
  const normalizedCompletion = Math.max(0, Math.min(1, Number(completionRate)));
  let score = Math.round(normalizedCompletion * 100) - Math.min(40, Number(exceptionCount) * 5);
  score = Math.max(0, Math.min(100, score));
  return { score, status: score >= 80 ? 'ready' : score >= 55 ? 'watch' : 'blocked' };
}
module.exports = { scoreOperationalReadiness };
