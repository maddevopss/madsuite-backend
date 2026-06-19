describe("jest environment", () => {
  test("loads .env.test", () => {
    expect(process.env.NODE_ENV).toBe("test");

    expect(process.env.JWT_SECRET).toBeDefined();
    expect(process.env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);

    expect(process.env.DB_HOST).toBe("localhost");
    expect(process.env.DB_NAME).toBe(process.env.TEST_DB_NAME || "madsuite_test");
  });
});
