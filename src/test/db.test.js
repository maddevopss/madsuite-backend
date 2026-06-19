jest.mock("pg", () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  })),
}));

describe("database bootstrap", () => {
  const originalEnv = process.env;

  function getConfiguredDatabase(poolConfig) {
    if (poolConfig.database) return poolConfig.database;
    return new URL(poolConfig.connectionString).pathname.replace(/^\//, "");
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("creates a pool for test database", () => {
    const { Pool } = require("pg");

    require("../../db");

    expect(Pool).toHaveBeenCalled();

    const poolConfig = Pool.mock.calls[0][0];

    expect(getConfiguredDatabase(poolConfig)).toBe(process.env.TEST_DB_NAME || "madsuite_test");
  });

  test("forces .env.test database when NODE_ENV is test", () => {
    process.env.DB_NAME = "madsuite";
    delete process.env.TEST_DB_NAME;
    delete process.env.TEST_DATABASE_URL;
    delete process.env.DATABASE_URL;

    const { Pool } = require("pg");

    require("../../db");

    expect(Pool).toHaveBeenCalled();

    const poolConfig = Pool.mock.calls[0][0];

    const database = getConfiguredDatabase(poolConfig);
    expect(database).toBe("madsuite_test");
    expect(database).toMatch(/test/i);
  });
});
