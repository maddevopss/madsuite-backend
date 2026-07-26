'use strict';

const { validateExternalCommand } = require('../integrations/externalIngress');

const command = {
  integrationId: 'payments-reference', organisationId: 'org-a', eventId: 'evt-1',
  type: 'payment.received', occurredAt: '2026-07-26T00:00:00Z', payload: { amount: 125 }
};
const policy = { organisationId: 'org-a', provider: 'reference', allowedTypes: ['payment.received'], seenEventIds: new Set() };

describe('external ingress', () => {
  test('builds a stable idempotency key', () => {
    expect(validateExternalCommand(command, policy).idempotencyKey).toBe('payments-reference:evt-1');
  });
  test('rejects foreign organisations, replay and authority fields', () => {
    expect(() => validateExternalCommand({ ...command, organisationId: 'org-b' }, policy)).toThrow('external_ingress.organisation_mismatch');
    expect(() => validateExternalCommand(command, { ...policy, seenEventIds: new Set(['evt-1']) })).toThrow('external_ingress.replay_detected');
    expect(() => validateExternalCommand({ ...command, payload: { approvedBy: 'external' } }, policy)).toThrow('external_ingress.authority_field_forbidden');
  });
});
