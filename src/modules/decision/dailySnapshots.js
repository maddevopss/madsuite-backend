function buildDailySnapshot({ organisationId, snapshotDate, metrics = {} }) {
  return {
    organisationId,
    snapshotDate,
    metrics,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { buildDailySnapshot };
