const {
  DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
  MAX_ACTIVITY_LOG_RETENTION_DAYS,
  MIN_ACTIVITY_LOG_RETENTION_DAYS,
  getActivityLogRetentionDays,
} = require("../config/activityRetention");

describe("activity log retention policy", () => {
  test("uses the default retention when env is missing or invalid", () => {
    expect(getActivityLogRetentionDays({})).toBe(DEFAULT_ACTIVITY_LOG_RETENTION_DAYS);
    expect(getActivityLogRetentionDays({ ACTIVITY_LOG_RETENTION_DAYS: "abc" })).toBe(DEFAULT_ACTIVITY_LOG_RETENTION_DAYS);
    expect(getActivityLogRetentionDays({ ACTIVITY_LOG_RETENTION_DAYS: "12.5" })).toBe(DEFAULT_ACTIVITY_LOG_RETENTION_DAYS);
  });

  test("bounds configured retention days", () => {
    expect(getActivityLogRetentionDays({ ACTIVITY_LOG_RETENTION_DAYS: "0" })).toBe(MIN_ACTIVITY_LOG_RETENTION_DAYS);
    expect(getActivityLogRetentionDays({ ACTIVITY_LOG_RETENTION_DAYS: "999" })).toBe(MAX_ACTIVITY_LOG_RETENTION_DAYS);
    expect(getActivityLogRetentionDays({ ACTIVITY_LOG_RETENTION_DAYS: "45" })).toBe(45);
  });
});
