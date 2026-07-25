const {
  EMPLOYEE_CREATE_POLICY,
  EMPLOYMENT_TRANSITION_POLICY,
  LEAVE_DECIDE_POLICY,
  COMPETENCY_VERIFY_POLICY,
  validIdempotency,
  transitionSpec,
} = require("../services/business/hr-transaction.service");
const { evaluatePolicy } = require("../services/business/transaction-engine.service");

describe("hr transactional core", () => {
  test("expose les politiques versionnées", () => {
    expect(EMPLOYEE_CREATE_POLICY).toBe("hr.employee.create@1");
    expect(EMPLOYMENT_TRANSITION_POLICY).toBe("hr.employment.transition@1");
    expect(LEAVE_DECIDE_POLICY).toBe("hr.leave.decide@1");
    expect(COMPETENCY_VERIFY_POLICY).toBe("hr.competency.verify@1");
  });

  test("valide les clés d’idempotence", () => {
    expect(validIdempotency("12345678")).toBe(true);
    expect(validIdempotency("court")).toBe(false);
  });

  test("refuse la création sans identité", async () => {
    const decision = await evaluatePolicy({ policy: EMPLOYEE_CREATE_POLICY, input: {}, idempotencyKey: "employee-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("hr.employee_identity_required");
  });

  test("refuse une suspension sans raison", async () => {
    const decision = await evaluatePolicy({ policy: EMPLOYMENT_TRANSITION_POLICY, input: { employeeId: 1, action: "suspend" }, idempotencyKey: "suspend-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("hr.reason_required");
  });

  test("décrit les transitions sans effacer l’historique", () => {
    expect(transitionSpec("activate", {})).toEqual(expect.objectContaining({ event: "activated", fields: { employment_status: "active" } }));
    expect(transitionSpec("terminate", { effectiveDate: "2026-08-31" })).toEqual(expect.objectContaining({ event: "terminated", fields: { employment_status: "terminated", termination_date: "2026-08-31" } }));
    expect(transitionSpec("change_role", { jobTitle: "Coordonnatrice" })).toEqual(expect.objectContaining({ event: "role_changed", fields: { job_title: "Coordonnatrice" } }));
  });

  test("exige une raison lors d’un refus d’absence", async () => {
    const decision = await evaluatePolicy({ policy: LEAVE_DECIDE_POLICY, input: { requestId: 1, action: "reject" }, idempotencyKey: "leave-001" });
    expect(decision.allowed).toBe(false);
  });

  test("valide l’attestation d’une compétence", async () => {
    const decision = await evaluatePolicy({ policy: COMPETENCY_VERIFY_POLICY, input: { employeeId: 1, competencyId: 2, issuedAt: "2026-07-25" }, idempotencyKey: "competency-001" });
    expect(decision.allowed).toBe(true);
  });
});
