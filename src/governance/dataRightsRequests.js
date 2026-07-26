'use strict';

const REQUEST_TYPES = Object.freeze(['access', 'export', 'rectification', 'objection', 'deletion']);

function createDataRightsRequest({ id, type, subjectId, organisationId, identityVerified, scope, requestedAt }) {
  if (!id || !REQUEST_TYPES.includes(type) || !subjectId || !organisationId || !requestedAt) throw new Error('complete request identity is required');
  if (!identityVerified) throw new Error('subject identity must be verified');
  if (!Array.isArray(scope) || scope.length === 0) throw new Error('verified scope is required');
  return Object.freeze({ id, type, subjectId, organisationId, identityVerified, scope: [...scope], requestedAt, status: 'pending' });
}

function decideDataRightsRequest(request, { decision, reason, decidedBy, decidedAt }) {
  if (!['approved', 'partially_approved', 'refused'].includes(decision)) throw new Error('valid decision is required');
  if (!reason || !decidedBy || !decidedAt) throw new Error('decision must be motivated and attributable');
  return Object.freeze({ ...request, status: decision, reason, decidedBy, decidedAt, reviewable: decision !== 'approved' });
}

module.exports = { REQUEST_TYPES, createDataRightsRequest, decideDataRightsRequest };
