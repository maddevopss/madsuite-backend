const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock("../../db", () => ({
  connect: jest.fn(),
}));

const db = require("../../db");
const { aggregateActivityLogs } = require("../jobs/aggregateActivityLogs");

describe("aggregateActivityLogs", () => {
  const originalRetention = process.env.ACTIVITY_LOG_RETENTION_DAYS;

  beforeEach(() => {
    db.connect.mockResolvedValue(mockClient);
    mockClient.query.mockImplementation((sql, params) => {
      if (String(sql).includes("FROM organisations")) {
        return Promise.resolve({ rows: [{ id: 123, timezone: "America/Montreal" }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  afterEach(() => {
    db.connect.mockReset();
    mockClient.query.mockReset();
    mockClient.release.mockReset();

    if (originalRetention === undefined) {
      delete process.env.ACTIVITY_LOG_RETENTION_DAYS;
    } else {
      process.env.ACTIVITY_LOG_RETENTION_DAYS = originalRetention;
    }
  });

  test("marks completed raw activity logs as aggregated", async () => {
    await aggregateActivityLogs();

    const updateCall = mockClient.query.mock.calls.find(([sql]) => sql.includes("UPDATE activity_logs"));

    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toEqual(["America/Montreal", 123]);
  });

  test("aggregates logs by organisation timezone with configured fallback", async () => {
    await aggregateActivityLogs();

    const aggregateCall = mockClient.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO activity_daily_summary"));

    expect(aggregateCall).toBeTruthy();
    expect(aggregateCall[0]).toContain("AT TIME ZONE $1");
    expect(aggregateCall[0]).toContain("organisation_id = $2");
    expect(aggregateCall[0]).toContain("organisation_id");
    expect(aggregateCall[1]).toEqual(["America/Montreal", 123]);
  });

  test("wraps aggregation and purge in a transaction", async () => {
    await aggregateActivityLogs();

    expect(mockClient.query.mock.calls[0][0]).toBe("BEGIN");
    expect(mockClient.query.mock.calls.at(-1)[0]).toBe("COMMIT");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
