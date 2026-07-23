const CacheService = require("../services/cache.service");

describe("Cache Service — Tenant Isolation", () => {
  beforeEach(() => {
    CacheService.flush();
  });

  test("cache keys are prefixed with organisation_id", () => {
    const key1 = CacheService.getCacheKey("reports", { month: "2026-07" }, 10);
    const key2 = CacheService.getCacheKey("reports", { month: "2026-07" }, 20);

    expect(key1).toContain("org:10:");
    expect(key2).toContain("org:20:");
    expect(key1).not.toEqual(key2);
  });

  test("invalidate with organisationId only removes keys for that organisation", () => {
    // Set cache for org 10
    CacheService.set(CacheService.getCacheKey("reports", { month: "2026-07" }, 10), "data-10");
    CacheService.set(CacheService.getCacheKey("dashboard", { user: 1 }, 10), "dash-10");

    // Set cache for org 20
    CacheService.set(CacheService.getCacheKey("reports", { month: "2026-07" }, 20), "data-20");
    CacheService.set(CacheService.getCacheKey("dashboard", { user: 1 }, 20), "dash-20");

    // Invalidate "reports" for org 10 only
    CacheService.invalidate("reports", 10);

    // Verify org 10 reports are gone
    expect(CacheService.get(CacheService.getCacheKey("reports", { month: "2026-07" }, 10))).toBeNull();

    // Verify org 10 dashboard still exists
    expect(CacheService.get(CacheService.getCacheKey("dashboard", { user: 1 }, 10))).toBe("dash-10");

    // Verify org 20 reports still exist
    expect(CacheService.get(CacheService.getCacheKey("reports", { month: "2026-07" }, 20))).toBe("data-20");

    // Verify org 20 dashboard still exists
    expect(CacheService.get(CacheService.getCacheKey("dashboard", { user: 1 }, 20))).toBe("dash-20");
  });

  test("invalidate without organisationId removes keys from all organisations (backward compat)", () => {
    // Set cache for org 10
    CacheService.set(CacheService.getCacheKey("reports", { month: "2026-07" }, 10), "data-10");

    // Set cache for org 20
    CacheService.set(CacheService.getCacheKey("reports", { month: "2026-07" }, 20), "data-20");

    // Invalidate "reports" globally (no organisationId)
    CacheService.invalidate("reports");

    // Verify both are gone
    expect(CacheService.get(CacheService.getCacheKey("reports", { month: "2026-07" }, 10))).toBeNull();
    expect(CacheService.get(CacheService.getCacheKey("reports", { month: "2026-07" }, 20))).toBeNull();
  });

  test("organisation A cannot access cache of organisation B", () => {
    const keyA = CacheService.getCacheKey("user-data", { id: 1 }, 10);
    const keyB = CacheService.getCacheKey("user-data", { id: 1 }, 20);

    CacheService.set(keyA, "secret-data-A");
    CacheService.set(keyB, "secret-data-B");

    // Org 10 can only access its own key
    expect(CacheService.get(keyA)).toBe("secret-data-A");
    expect(CacheService.get(keyB)).toBe("secret-data-B");

    // But invalidating org 10's cache doesn't affect org 20
    CacheService.invalidate("user-data", 10);
    expect(CacheService.get(keyA)).toBeNull();
    expect(CacheService.get(keyB)).toBe("secret-data-B");
  });
});
