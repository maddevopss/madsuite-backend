const { computeRetry, quarantineRecord, releaseQuarantine } = require('../operations/retryPolicy');

describe('retry and quarantine contract', () => {
  test('uses bounded exponential delay', () => {
    expect(computeRetry({ attempt: 2, baseDelayMs: 1000, maxDelayMs: 5000 })).toEqual(expect.objectContaining({ action: 'retry', attempt: 3, delayMs: 4000 }));
    expect(computeRetry({ attempt: 4, maxAttempts: 4 }).action).toBe('quarantine');
  });

  test('requires a traceable manual release', () => {
    const record = quarantineRecord({ id: 7, reason: 'delivery.failed', actor: 'worker' }, new Date('2026-01-01T00:00:00Z'));
    const released = releaseQuarantine(record, { actor: 'admin:4', justification: 'Cause corrigée', now: new Date('2026-01-02T00:00:00Z') });
    expect(released).toEqual(expect.objectContaining({ releasedBy: 'admin:4', releaseJustification: 'Cause corrigée' }));
    expect(() => releaseQuarantine(record, { actor: 'admin:4', justification: '' })).toThrow('quarantine.release.invalid');
  });
});
