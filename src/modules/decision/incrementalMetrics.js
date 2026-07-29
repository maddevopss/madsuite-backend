function mergeMetric(previous = 0, delta = 0) {
  const result = Number(previous) + Number(delta);
  if (!Number.isFinite(result)) throw new Error('Invalid metric value');
  return result;
}

module.exports = { mergeMetric };
