function calculateGrowth({ current = 0, previous = 0 }) {
  if (Number(previous) === 0) return { absolute: Number(current), percent: null };
  const absolute = Number(current) - Number(previous);
  return { absolute, percent: (absolute / Math.abs(Number(previous))) * 100 };
}

module.exports = { calculateGrowth };
