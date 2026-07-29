function buildCacheKey({ organisationId, metric, period, filters = {} }) {
  return JSON.stringify({ organisationId, metric, period, filters });
}

function shouldRefresh({ generatedAt, ttlSeconds = 300, now = Date.now() }) {
  return now - new Date(generatedAt).getTime() >= ttlSeconds * 1000;
}

module.exports = { buildCacheKey, shouldRefresh };
