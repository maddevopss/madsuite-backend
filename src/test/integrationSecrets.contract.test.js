'use strict';

const { rotateSecret, redactSecret } = require('../integrations/integrationSecrets');

const secret = {
  integrationId: 'calendar-reference', organisationId: 'org-a', environment: 'staging',
  vaultRef: 'vault://integrations/calendar/a', status: 'active', expiresAt: '2027-01-01T00:00:00Z'
};

describe('integration secret lifecycle', () => {
  test('rotates only within the same organisation and environment', () => {
    expect(rotateSecret(secret, { ...secret, vaultRef: 'vault://integrations/calendar/b' }).previous.status).toBe('revoked');
    expect(() => rotateSecret(secret, { ...secret, organisationId: 'org-b' })).toThrow('integration_secret.scope_mismatch');
  });

  test('redacts nested credentials', () => {
    expect(redactSecret({ headers: { authorization: 'Bearer x' }, apiKey: 'x' }))
      .toEqual({ headers: { authorization: '[REDACTED]' }, apiKey: '[REDACTED]' });
  });
});
