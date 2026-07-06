const {
  normalizeEnabledMap,
  normalizePricingMap,
  buildModulesPayload,
} = require("../services/modules.service");

describe("modules service", () => {
  test("normalizes enabled rows", () => {
    expect(normalizeEnabledMap([
      { module_key: "quotes", is_active: true },
      { module_key: "payments", is_active: false },
      { module_key: null, is_active: true },
    ])).toEqual({
      quotes: true,
      payments: false,
    });
  });

  test("normalizes pricing rows", () => {
    expect(normalizePricingMap([
      { module_key: "quotes", price_cents: 500, currency: "CAD" },
      { module_key: "payments", price_cents: 0, currency: null },
    ])).toEqual({
      quotes: { price_cents: 500, currency: "CAD" },
      payments: { price_cents: 0, currency: "CAD" },
    });
  });

  test("builds the modules API contract", () => {
    const payload = buildModulesPayload({
      planType: "admin",
      enabledMap: { quotes: true },
      pricingMap: { quotes: { price_cents: 500, currency: "CAD" } },
    });

    expect(payload).toEqual(expect.objectContaining({
      plan_type: "admin",
      diagnostics: expect.any(Object),
      modules: expect.any(Array),
    }));

    const quotes = payload.modules.find((module) => module.key === "quotes");
    expect(quotes).toEqual(expect.objectContaining({
      key: "quotes",
      label: expect.any(String),
      plan: "addon",
      price: 5,
      currency: "CAD",
      matrix_status: expect.any(String),
      is_active: true,
      active: true,
      included_in_plan: true,
      included: true,
      is_addon_active: false,
    }));
  });

  test("includes internal modules for internal plans", () => {
    const payload = buildModulesPayload({ planType: "admin" });
    const cognitive = payload.modules.find((module) => module.key === "cognitive_engine");

    expect(cognitive).toEqual(expect.objectContaining({
      key: "cognitive_engine",
      is_active: true,
      included_in_plan: true,
    }));
  });
});
