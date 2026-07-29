function normalizeMetricRow(row = {}) {
  return {
    organisationId: row.organisationId,
    metric: String(row.metric || '').trim(),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    value: Number(row.value || 0),
    dimensions: row.dimensions || {},
  };
}

module.exports = { normalizeMetricRow };
