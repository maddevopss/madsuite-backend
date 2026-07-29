const ALLOWED_PERIODS = new Set(['day', 'week', 'month', 'quarter', 'year']);

function validateDashboardQuery(query = {}) {
  const period = String(query.period || 'month');
  if (!ALLOWED_PERIODS.has(period)) throw new Error('Unsupported dashboard period');
  return { period, from: query.from || null, to: query.to || null, filters: query.filters || {} };
}

module.exports = { validateDashboardQuery };
