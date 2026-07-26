const REQUIRED = ['NODE_ENV', 'DATABASE_URL', 'JWT_SECRET', 'FRONTEND_URL', 'BACKUP_TARGET'];

function assessStagingReadiness(env = {}) {
  const missing = REQUIRED.filter(key => !String(env[key] || '').trim());
  const production = env.NODE_ENV === 'production';
  const isolatedDatabase = Boolean(env.DATABASE_URL) && !/prod|production/i.test(env.DATABASE_URL);
  const destructiveTestsAllowed = !production && env.ALLOW_DESTRUCTIVE_TESTS === 'true';
  return {
    contract: 'staging-readiness@1',
    ready: missing.length === 0 && !production && isolatedDatabase,
    missing,
    production,
    isolatedDatabase,
    destructiveTestsAllowed,
  };
}

module.exports = { REQUIRED, assessStagingReadiness };
