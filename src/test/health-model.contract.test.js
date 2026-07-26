const { summarizeHealth } = require('../operations/healthModel');

describe('health report contract', () => {
  test('separates technical, dependency and functional health', () => {
    const report = summarizeHealth({
      technical: [{ name: 'http', status: 'healthy' }],
      dependencies: [{ name: 'postgresql', status: 'degraded', detailCode: 'db.slow' }],
      functional: [{ name: 'outbox', status: 'healthy' }],
    });
    expect(report.status).toBe('degraded');
    expect(report.dimensions.dependencies[0].detailCode).toBe('db.slow');
  });

  test('marks a critical unavailable dependency as unavailable', () => {
    const report = summarizeHealth({ dependencies: [{ name: 'postgresql', status: 'unavailable' }] });
    expect(report.status).toBe('unavailable');
  });

  test('returns a secret-free summary shape', () => {
    const report = summarizeHealth({ technical: [{ name: 'http', status: 'healthy', secret: 'nope' }] });
    expect(report.safeSummary[0]).toEqual({ name: 'http', status: 'healthy', detailCode: null });
    expect(report.safeSummary[0].secret).toBeUndefined();
  });
});
