'use strict';

const { signWebhook, verifyWebhookSignature, nextDeliveryState } = require('../integrations/webhookDelivery');

describe('outbound webhook delivery', () => {
  test('accepts a fresh signature and rejects stale delivery', () => {
    const timestamp = Date.now();
    const body = '{"event":"invoice.paid"}';
    const signature = signWebhook({ secret: 'secret', timestamp, body });
    expect(verifyWebhookSignature({ secret: 'secret', timestamp, body, signature, now: timestamp })).toBe(true);
    expect(verifyWebhookSignature({ secret: 'secret', timestamp, body, signature, now: timestamp + 600000 })).toBe(false);
  });

  test('moves exhausted deliveries to quarantine', () => {
    expect(nextDeliveryState({ attempts: 4, maxAttempts: 5 }, false).status).toBe('quarantined');
  });
});
