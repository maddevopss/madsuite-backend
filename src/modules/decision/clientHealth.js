function calculateClientHealth({ overdueCents = 0, revenueCents = 0, activeProjects = 0, daysSinceActivity = 0 }) {
  let score = 100;
  if (Number(overdueCents) > 0) score -= 25;
  if (Number(revenueCents) <= 0) score -= 20;
  if (Number(activeProjects) === 0) score -= 15;
  if (Number(daysSinceActivity) > 30) score -= 20;
  return Math.max(0, score);
}

module.exports = { calculateClientHealth };
