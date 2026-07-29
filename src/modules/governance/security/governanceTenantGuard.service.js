'use strict';

function normalizeId(value) {
  return value === undefined || value === null ? null : String(value);
}

function assertSameOrganisation({ actorOrganisationId, resourceOrganisationId }) {
  const actorOrg = normalizeId(actorOrganisationId);
  const resourceOrg = normalizeId(resourceOrganisationId);

  if (!actorOrg || !resourceOrg) {
    const error = new Error('organisation_context_required');
    error.code = 'GOVERNANCE_ORGANISATION_CONTEXT_REQUIRED';
    throw error;
  }

  if (actorOrg !== resourceOrg) {
    const error = new Error('cross_organisation_access_denied');
    error.code = 'GOVERNANCE_CROSS_ORGANISATION_DENIED';
    throw error;
  }

  return Object.freeze({ allowed: true, organisationId: actorOrg });
}

function scopeGovernanceQuery(organisationId, filters = {}) {
  const org = normalizeId(organisationId);
  if (!org) throw new TypeError('organisationId_required');

  if (filters.organisationId && normalizeId(filters.organisationId) !== org) {
    throw new Error('organisation_filter_override_denied');
  }

  return Object.freeze({ ...filters, organisationId: org });
}

module.exports = { assertSameOrganisation, scopeGovernanceQuery };
