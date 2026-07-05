const {
  MODULES,
  FREE_MODULES,
  PRO_MODULES,
  ADDON_MODULES,
  INTERNAL_MODULES,
  isModuleIncludedInPlan,
  getModuleRegistryDiagnostics,
} = require("../config/modules");

describe("modules registry", () => {
  test("contains the MADSuite core modules", () => {
    expect(Object.keys(MODULES)).toEqual(expect.arrayContaining([
      "clients",
      "projects",
      "time_tracking",
      "invoices",
    ]));
  });

  test("keeps legacy UI module keys available", () => {
    expect(Object.keys(MODULES)).toEqual(expect.arrayContaining([
      "dashboard",
      "timesheet",
    ]));
  });

  test("classifies modules by plan", () => {
    expect(FREE_MODULES).toEqual(expect.arrayContaining(["clients", "projects", "time_tracking"]));
    expect(PRO_MODULES).toEqual(expect.arrayContaining(["invoices", "reports"]));
    expect(ADDON_MODULES).toEqual(expect.arrayContaining(["estimates", "quotes", "payments"]));
    expect(INTERNAL_MODULES).toEqual(expect.arrayContaining(["cognitive_engine", "desktop_agent"]));
  });

  test("includes internal modules only for internal plans", () => {
    expect(isModuleIncludedInPlan("cognitive_engine", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("desktop_agent", "internal")).toBe(true);
    expect(isModuleIncludedInPlan("cognitive_engine", "pro")).toBe(false);
    expect(isModuleIncludedInPlan("desktop_agent", "free")).toBe(false);
  });

  test("includes pro modules for pro and enterprise", () => {
    expect(isModuleIncludedInPlan("invoices", "pro")).toBe(true);
    expect(isModuleIncludedInPlan("invoices", "enterprise")).toBe(true);
    expect(isModuleIncludedInPlan("invoices", "free")).toBe(false);
  });

  test("returns registry diagnostics", () => {
    expect(getModuleRegistryDiagnostics()).toEqual(expect.objectContaining({
      duplicateKeys: [],
      modulesWithoutMatrixStatus: [],
    }));
  });
});
