const { buildJobRegistry, executionWindow } = require('../operations/jobRegistry');

describe('scheduled jobs registry', () => {
  const job = { name: 'outbox.delivery', owner: 'platform', schedule: '* * * * *', lockKey: 'outbox_delivery', timeoutMs: 30000 };

  test('builds a versioned registry', () => {
    const registry = buildJobRegistry([job]);
    expect(registry.contract).toBe('scheduled-jobs@1');
    expect(registry.jobs[0]).toEqual(expect.objectContaining({ name: 'outbox.delivery', timeoutMs: 30000 }));
  });

  test('rejects duplicate locks', () => {
    expect(() => buildJobRegistry([job, { ...job, name: 'other' }])).toThrow('job.lock.duplicate');
  });

  test('computes a bounded execution window', () => {
    const window = executionWindow(buildJobRegistry([job]).jobs[0], new Date('2026-01-01T00:00:00.000Z'));
    expect(window.deadlineAt).toBe('2026-01-01T00:00:30.000Z');
  });
});
