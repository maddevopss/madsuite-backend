const FORBIDDEN_KEYS = new Set(['password', 'token', 'secret', 'refresh_token', 'access_token']);

function minimize(value, allowedFields) {
  const result = {};
  for (const field of allowedFields) {
    if (FORBIDDEN_KEYS.has(String(field).toLowerCase())) continue;
    if (Object.prototype.hasOwnProperty.call(value || {}, field)) result[field] = value[field];
  }
  return result;
}

function buildControlledContext({ organisationId, userOrganisationId, records = [], allowedFields = [], validUntil, sources = [] }) {
  if (!organisationId || String(organisationId) !== String(userOrganisationId)) throw new Error('ai.context.cross_tenant_forbidden');
  if (!validUntil || new Date(validUntil).getTime() <= Date.now()) throw new Error('ai.context.validity_required');
  const foreign = records.find((record) => String(record.organisation_id) !== String(organisationId));
  if (foreign) throw new Error('ai.context.cross_tenant_reference');
  return {
    contract: 'controlled-institutional-context@1',
    organisationId,
    validUntil,
    provenance: sources.map((source) => ({ id: source.id, type: source.type, capturedAt: source.capturedAt })),
    records: records.map((record) => minimize(record, allowedFields)),
  };
}

module.exports = { buildControlledContext, minimize };
