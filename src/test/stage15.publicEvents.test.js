'use strict';

const { publishPublicEvent, authorizeSubscription } = require('../platform/ecosystem/publicEvents');

describe('stage 15 public events', () => {
  test('requires explicit sensitive fields', () => {
    expect(() => publishPublicEvent({ name: 'invoice.created', version: '1.0.0', schema: {}, idempotencyKey: 'k1', organisationId: 'org-a', containsSensitiveData: true, explicitSensitiveFields: [] }, {})).toThrow('sensitive fields');
  });

  test('requires approved organisation-scoped subscriptions', () => {
    expect(() => authorizeSubscription({ partnerId: 'p1', eventName: 'invoice.created', organisationId: 'org-a' })).toThrow('approved subscription');
  });
});
