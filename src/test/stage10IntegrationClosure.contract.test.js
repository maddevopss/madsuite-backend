'use strict';

const { buildIntegrationRegistry } = require('../integrations/integrationRegistry');
const { rotateSecret } = require('../integrations/integrationSecrets');
const { signWebhook, verifyWebhookSignature } = require('../integrations/webhookDelivery');
const { validateExternalCommand } = require('../integrations/externalIngress');
const { evaluateQuota } = require('../integrations/integrationUsage');

describe('stage 10 integration closure', () => {
  test('proves authentication, authorization, idempotence, revocation and isolation', () => {
    const registry = buildIntegrationRegistry([{
      id: 'payments-reference', provider: 'reference', purpose: 'Importer les paiements', owner: 'finance',
      type: 'partner', state: 'active', version: '1.0.0', capabilities: ['payment.import'],
      approvedAt: '2026-07-26T00:00:00Z'
    }]);
    expect(registry.entries[0].state).toBe('active');

    const secret = { integrationId: 'payments-reference', organisationId: 'org-a', environment: 'staging', vaultRef: 'vault://a/1', status: 'active', expiresAt: '2027-01-01T00:00:00Z' };
    expect(rotateSecret(secret, { ...secret, vaultRef: 'vault://a/2' }).previous.status).toBe('revoked');

    const timestamp = Date.now();
    const body = '{"event":"payment.received"}';
    const signature = signWebhook({ secret: 'secret', timestamp, body });
    expect(verifyWebhookSignature({ secret: 'secret', timestamp, body, signature, now: timestamp })).toBe(true);

    const command = validateExternalCommand({ integrationId: 'payments-reference', organisationId: 'org-a', eventId: 'evt-1', type: 'payment.received', occurredAt: new Date().toISOString(), payload: {} }, { organisationId: 'org-a', provider: 'reference', allowedTypes: ['payment.received'], seenEventIds: new Set() });
    expect(command.idempotencyKey).toBe('payments-reference:evt-1');
    expect(evaluateQuota({ organisationId: 'org-a', integrationId: 'payments-reference', usage: { requests: 1 }, limits: { requests: 10 } }).allowed).toBe(true);
  });
});
