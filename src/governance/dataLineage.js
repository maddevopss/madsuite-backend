'use strict';

function recordLineage({ assetId, source, transformations = [], destinations = [], organisationId, occurredAt }) {
  if (!assetId || !source || !organisationId || !occurredAt) throw new Error('lineage identity, source, organisation and time are required');
  if (!Array.isArray(transformations) || !Array.isArray(destinations)) throw new TypeError('lineage steps must be arrays');
  return Object.freeze({ assetId, source, transformations: [...transformations], destinations: [...destinations], organisationId, occurredAt });
}

function reconstructLineage(records, assetId, organisationId) {
  return records.filter(record => record.assetId === assetId && record.organisationId === organisationId)
    .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
}

module.exports = { recordLineage, reconstructLineage };
