'use strict';

function validateExternalCommand(command, policy) {
  const required = ['integrationId', 'organisationId', 'eventId', 'type', 'occurredAt', 'payload'];
  for (const field of required) if (command[field] === undefined || command[field] === null) throw new Error(`external_ingress.${field}.required`);
  if (command.organisationId !== policy.organisationId) throw new Error('external_ingress.organisation_mismatch');
  if (!policy.allowedTypes.includes(command.type)) throw new Error('external_ingress.type_forbidden');
  if (policy.seenEventIds && policy.seenEventIds.has(command.eventId)) throw new Error('external_ingress.replay_detected');
  if (command.payload && Object.prototype.hasOwnProperty.call(command.payload, 'approvedBy')) {
    throw new Error('external_ingress.authority_field_forbidden');
  }
  return Object.freeze({ ...command, authenticatedProvider: policy.provider, idempotencyKey: `${command.integrationId}:${command.eventId}` });
}

module.exports = { validateExternalCommand };
