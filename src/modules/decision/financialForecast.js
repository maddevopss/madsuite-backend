function movingAverage(values = [], window = 3) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  const slice = clean.slice(-Math.max(1, Number(window)));
  return Math.round(slice.reduce((sum, value) => sum + value, 0) / slice.length);
}

module.exports = { movingAverage };
