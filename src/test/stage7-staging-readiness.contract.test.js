const { assessStagingReadiness } = require('../ops/stagingReadiness');

describe('stage7 staging readiness', () => {
  test('accepts an isolated staging environment', () => {
    const result = assessStagingReadiness({ NODE_ENV: 'staging', DATABASE_URL: 'postgres://staging-db', JWT_SECRET: 'x', FRONTEND_URL: 'https://staging.example', BACKUP_TARGET: 's3://staging', ALLOW_DESTRUCTIVE_TESTS: 'true' });
    expect(result.ready).toBe(true);
    expect(result.destructiveTestsAllowed).toBe(true);
  });
  test('forbids destructive validation in production', () => {
    const result = assessStagingReadiness({ NODE_ENV: 'production', DATABASE_URL: 'postgres://production-db', JWT_SECRET: 'x', FRONTEND_URL: 'https://example', BACKUP_TARGET: 's3://prod', ALLOW_DESTRUCTIVE_TESTS: 'true' });
    expect(result.ready).toBe(false);
    expect(result.destructiveTestsAllowed).toBe(false);
  });
});
