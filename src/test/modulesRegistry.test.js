const {
  MODULES,
  FREE_MODULES,
  PRO_MODULES,
  SOLO_MODULES,
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
    expect(PRO_MODULES).toEqual(expect.arrayContaining(["reports", "kiosk_punch"]));
    expect(SOLO_MODULES).toEqual(["invoices"]);
    expect(ADDON_MODULES).toEqual(expect.arrayContaining(["estimates", "quotes", "payments"]));
    expect(INTERNAL_MODULES).toEqual(expect.arrayContaining(["cognitive_engine", "desktop_agent"]));
  });

  test("includes internal modules only for internal plans", () => {
    expect(isModuleIncludedInPlan("cognitive_engine", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("desktop_agent", "internal")).toBe(true);
    expect(isModuleIncludedInPlan("cognitive_engine", "pro")).toBe(false);
    expect(isModuleIncludedInPlan("desktop_agent", "free")).toBe(false);
  });

  test("includes invoices for Trial, Solo, Pro and internal plans", () => {
    expect(isModuleIncludedInPlan("invoices", "trial")).toBe(true);
    expect(isModuleIncludedInPlan("invoices", "solo")).toBe(true);
    expect(isModuleIncludedInPlan("invoices", "pro")).toBe(true);
    expect(isModuleIncludedInPlan("invoices", "free")).toBe(false);
  });

  test("includes pro modules for pro and enterprise", () => {
    expect(isModuleIncludedInPlan("invoices", "pro")).toBe(true);
    expect(isModuleIncludedInPlan("invoices", "enterprise")).toBe(true);
    expect(isModuleIncludedInPlan("invoices", "free")).toBe(false);
  });

  test("enterprise plan includes ADDON modules but NOT INTERNAL", () => {
    expect(isModuleIncludedInPlan("estimates", "enterprise")).toBe(true);
    expect(isModuleIncludedInPlan("quotes", "enterprise")).toBe(true);
    expect(isModuleIncludedInPlan("expenses", "enterprise")).toBe(true);
    expect(isModuleIncludedInPlan("activity_intelligence", "enterprise")).toBe(true);
    expect(isModuleIncludedInPlan("billing_assistant", "enterprise")).toBe(true);
    expect(isModuleIncludedInPlan("cognitive_engine", "enterprise")).toBe(false);
    expect(isModuleIncludedInPlan("desktop_agent", "enterprise")).toBe(false);
  });

  test("Solo and Pro plans may activate ADDON modules", () => {
    expect(isModuleIncludedInPlan("estimates", "solo")).toBe(true);
    expect(isModuleIncludedInPlan("quotes", "pro")).toBe(true);
    expect(isModuleIncludedInPlan("expenses", "pro")).toBe(true);
  });

  test("returns registry diagnostics", () => {
    expect(getModuleRegistryDiagnostics()).toEqual(expect.objectContaining({
      duplicateKeys: [],
      modulesWithoutMatrixStatus: [],
    }));
  });
});
