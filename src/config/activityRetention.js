const DEFAULT_ACTIVITY_LOG_RETENTION_DAYS = 30;
const MIN_ACTIVITY_LOG_RETENTION_DAYS = 1;
const MAX_ACTIVITY_LOG_RETENTION_DAYS = 365;

function getActivityLogRetentionDays(env = process.env) {
  const parsed = Number(env.ACTIVITY_LOG_RETENTION_DAYS);

  if (!Number.isInteger(parsed)) {
    return DEFAULT_ACTIVITY_LOG_RETENTION_DAYS;
  }

  if (parsed < MIN_ACTIVITY_LOG_RETENTION_DAYS) {
    return MIN_ACTIVITY_LOG_RETENTION_DAYS;
  }

  if (parsed > MAX_ACTIVITY_LOG_RETENTION_DAYS) {
    return MAX_ACTIVITY_LOG_RETENTION_DAYS;
  }

  return parsed;
}

module.exports = {
  DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
  MAX_ACTIVITY_LOG_RETENTION_DAYS,
  MIN_ACTIVITY_LOG_RETENTION_DAYS,
  getActivityLogRetentionDays,
};
