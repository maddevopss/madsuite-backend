const {
  MODULES,
  isModuleIncludedInPlan,
} = require("../config/modules");

describe("modules registry - admin plan access", () => {
  test("admin plan includes all FREE modules", () => {
    expect(isModuleIncludedInPlan("dashboard", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("clients", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("projects", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("time_tracking", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("timesheet", "admin")).toBe(true);
  });

  test("admin plan includes all PRO modules", () => {
    expect(isModuleIncludedInPlan("invoices", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("reports", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("kiosk_punch", "admin")).toBe(true);
  });

  test("admin plan includes all ADDON modules", () => {
    expect(isModuleIncludedInPlan("calcul_km", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("kiosk_km", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("estimates", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("quotes", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("expenses", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("payments", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("activity_intelligence", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("billing_assistant", "admin")).toBe(true);
  });

  test("admin plan includes all INTERNAL modules", () => {
    expect(isModuleIncludedInPlan("cognitive_engine", "admin")).toBe(true);
    expect(isModuleIncludedInPlan("desktop_agent", "admin")).toBe(true);
  });

  test("free plan does NOT include INTERNAL modules", () => {
    expect(isModuleIncludedInPlan("cognitive_engine", "free")).toBe(false);
    expect(isModuleIncludedInPlan("desktop_agent", "free")).toBe(false);
  });

  test("pro plan does NOT include INTERNAL modules", () => {
    expect(isModuleIncludedInPlan("cognitive_engine", "pro")).toBe(false);
    expect(isModuleIncludedInPlan("desktop_agent", "pro")).toBe(false);
  });

  test("admin plan is case-insensitive", () => {
    expect(isModuleIncludedInPlan("cognitive_engine", "ADMIN")).toBe(true);
    expect(isModuleIncludedInPlan("cognitive_engine", "Admin")).toBe(true);
  });

  test("all internal plan types grant access to internal modules", () => {
    const internalPlanTypes = ["admin", "internal", "master_admin", "platform_admin"];
    internalPlanTypes.forEach((planType) => {
      expect(isModuleIncludedInPlan("cognitive_engine", planType)).toBe(true);
      expect(isModuleIncludedInPlan("desktop_agent", planType)).toBe(true);
    });
  });
});
