const { redactRecord, retentionDecision } = require('../security/sensitiveDataPolicy');

describe('sensitive data policy', () => {
  test('masque secrets et données confidentielles', () => {
    expect(redactRecord({ email: 'a@b.ca', token: 'x', name: 'A' })).toEqual({ email: '[REDACTED]', token: '[REDACTED]', name: 'A' });
  });

  test('respecte une retenue légale', () => {
    expect(retentionDecision({ classification: 'secret', ageDays: 999, legalHold: true }).action).toBe('retain');
  });
});