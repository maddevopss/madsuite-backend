function calculateTrend(current = 0, previous = 0) {
  if (Number(previous) === 0) return { change: Number(current), percent: null };
  const change = Number(current) - Number(previous);
  return { change, percent: (change / Math.abs(Number(previous))) * 100 };
}

module.exports = { calculateTrend };
