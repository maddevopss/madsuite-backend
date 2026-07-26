const LEVELS = ['healthy', 'degraded', 'unavailable'];

function normalizeCheck(check = {}) {
  const status = String(check.status || '').trim().toLowerCase();
  if (!check.name || !LEVELS.includes(status)) throw new Error('health.check.invalid');
  return { name: String(check.name), status, critical: check.critical !== false, detailCode: check.detailCode || null };
}

function summarizeHealth({ technical = [], dependencies = [], functional = [] } = {}) {
  const groups = { technical, dependencies, functional };
  const normalized = Object.fromEntries(Object.entries(groups).map(([name, checks]) => [name, checks.map(normalizeCheck)]));
  const all = Object.values(normalized).flat();
  const criticalUnavailable = all.some((item) => item.critical && item.status === 'unavailable');
  const degraded = all.some((item) => item.status !== 'healthy');
  return {
    contract: 'health-report@1',
    status: criticalUnavailable ? 'unavailable' : degraded ? 'degraded' : 'healthy',
    dimensions: normalized,
    safeSummary: all.map(({ name, status, detailCode }) => ({ name, status, detailCode })),
  };
}

module.exports = { LEVELS, normalizeCheck, summarizeHealth };
