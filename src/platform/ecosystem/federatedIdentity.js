'use strict';

function validateFederatedLogin(assertion, authorization) {
  if (!assertion?.issuer || !assertion?.subject || !assertion?.audience || !assertion?.expiresAt) throw new Error('identity assertion is incomplete');
  if (!authorization?.organisationId || !authorization?.scopes?.length || authorization.consent !== true) throw new Error('explicit authorization is required');
  if (assertion.organisationId && assertion.organisationId !== authorization.organisationId) throw new Error('organisation mismatch');
  if (new Date(assertion.expiresAt) <= new Date()) throw new Error('identity assertion expired');
  return Object.freeze({ subject: assertion.subject, organisationId: authorization.organisationId, scopes: [...authorization.scopes], revocable: true });
}

module.exports = { validateFederatedLogin };
