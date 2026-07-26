const { correlationId, redact, structuredEvent } = require('../operations/observability');

describe('observability contract', () => {
  test('preserves a valid correlation id', () => {
    expect(correlationId('req-12345678')).toBe('req-12345678');
  });

  test('redacts sensitive values recursively', () => {
    expect(redact({ token: 'abc', nested: { password: 'pwd', safe: 7 } })).toEqual({ token: '[REDACTED]', nested: { password: '[REDACTED]', safe: 7 } });
  });

  test('creates a structured event', () => {
    const event = structuredEvent({ module: 'billing', event: 'invoice.finalized', correlation: 'req-12345678', organisationId: 4, data: { authorization: 'Bearer secret' }, now: new Date('2026-01-01T00:00:00Z') });
    expect(event).toEqual(expect.objectContaining({ contract: 'structured-log@1', correlationId: 'req-12345678', organisationId: '4' }));
    expect(event.data.authorization).toBe('[REDACTED]');
  });
});
