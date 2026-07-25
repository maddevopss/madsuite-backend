jest.mock("../../db", () => ({ pool: { connect: jest.fn() } }));
jest.mock("../services/business/business-event.service", () => ({ appendEvent: jest.fn() }));
jest.mock("../services/business/trust-persistence.service", () => ({ persistTrustAssessment: jest.fn(), persistGraphEdges: jest.fn() }));

const {
  CALCULATE_POLICY,
  APPROVE_POLICY,
  PAY_POLICY,
  VOID_POLICY,
  validIdempotency,
  money,
  computeEmployeeLine,
} = require("../services/business/payroll-transaction.service");
const { resolvePolicy } = require("../services/business/transaction-engine.service");

describe("paie transactionnelle CTMAD", () => {
  test("enregistre les politiques versionnées", () => {
    expect(resolvePolicy(CALCULATE_POLICY).version).toBe("1");
    expect(resolvePolicy(APPROVE_POLICY).version).toBe("1");
    expect(resolvePolicy(PAY_POLICY).version).toBe("1");
    expect(resolvePolicy(VOID_POLICY).version).toBe("1");
  });

  test("valide l’idempotence et les montants", () => {
    expect(validIdempotency("payroll-123")).toBe(true);
    expect(validIdempotency("court")).toBe(false);
    expect(money("12.345")).toBe(12.35);
    expect(money("x")).toBeNull();
  });

  test("calcule une paie horaire à partir du jeu de règles fourni", () => {
    const result = computeEmployeeLine(
      { pay_type: "hourly", hourly_rate: 25 },
      { regularHours: 40, overtimeHours: 2 },
      { overtimeMultiplier: 1.5, employeeDeductions: { retenueA: 0.1 }, employerContributions: { chargeA: 0.05 } },
    );
    expect(result.grossPay).toBe(1075);
    expect(result.deductions.retenueA).toBe(107.5);
    expect(result.employerContributions.chargeA).toBe(53.75);
    expect(result.netPay).toBe(967.5);
  });

  test("calcule une paie salariale selon le nombre de périodes versionné", () => {
    const result = computeEmployeeLine(
      { pay_type: "salary", annual_salary: 52000 },
      {},
      { payPeriodsPerYear: 26, employeeDeductions: {}, employerContributions: {} },
    );
    expect(result.grossPay).toBe(2000);
    expect(result.netPay).toBe(2000);
  });

  test("refuse une annulation sans raison", () => {
    const result = resolvePolicy(VOID_POLICY).evaluate({ idempotencyKey: "void-12345", input: { runId: 1, reason: "" } });
    expect(result.allowed).toBe(false);
  });
});
