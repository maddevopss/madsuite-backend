const { evaluatePolicy } = require("../services/business/transaction-engine.service");
const {
  QUALITY_PLAN_POLICY,
  QUALITY_PLAN_TRANSITION_POLICY,
  INSPECTION_POLICY,
  NONCONFORMITY_TRANSITION_POLICY,
  CORRECTIVE_ACTION_TRANSITION_POLICY,
  AUDIT_TRANSITION_POLICY,
} = require("../services/business/quality-transaction.service");

describe("quality transactional core", () => {
  test("refuse un plan sans critères d'acceptation", async () => {
    const decision = await evaluatePolicy({ policy: QUALITY_PLAN_POLICY, input: { code: "QC-01", title: "Contrôle", scopeType: "product", version: "1" }, idempotencyKey: "quality-plan-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("quality.acceptance_criteria_required");
  });

  test("autorise un plan traçable avec critères", async () => {
    const decision = await evaluatePolicy({ policy: QUALITY_PLAN_POLICY, input: { code: "QC-01", title: "Contrôle", scopeType: "product", version: "1", acceptanceCriteria: [{ field: "diameter", max: 10 }] }, idempotencyKey: "quality-plan-002" });
    expect(decision.allowed).toBe(true);
  });

  test("refuse l'activation d'un plan sans preuve", async () => {
    const decision = await evaluatePolicy({ policy: QUALITY_PLAN_TRANSITION_POLICY, input: { action: "active", evidence: [] }, idempotencyKey: "quality-plan-active-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("quality.approval_evidence_required");
  });

  test("refuse une inspection rejetée sans preuve", async () => {
    const decision = await evaluatePolicy({ policy: INSPECTION_POLICY, input: { inspectionNumber: "QI-1", subjectType: "lot", subjectId: "L-1", result: "rejected", reason: "Défaut", evidence: [] }, idempotencyKey: "quality-inspection-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("quality.inspection_evidence_required");
  });

  test("refuse une quantité négative", async () => {
    const decision = await evaluatePolicy({ policy: INSPECTION_POLICY, input: { inspectionNumber: "QI-2", subjectType: "lot", subjectId: "L-2", sampleSize: -1, result: "pending" }, idempotencyKey: "quality-inspection-002" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("quality.quantity_invalid");
  });

  test("exige une action de confinement", async () => {
    const decision = await evaluatePolicy({ policy: NONCONFORMITY_TRANSITION_POLICY, input: { action: "contained" }, idempotencyKey: "quality-nc-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("quality.containment_required");
  });

  test("refuse la fermeture d'une non-conformité sans preuve", async () => {
    const decision = await evaluatePolicy({ policy: NONCONFORMITY_TRANSITION_POLICY, input: { action: "closed", reason: "Corrigée", evidence: [] }, idempotencyKey: "quality-nc-002" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("quality.verification_evidence_required");
  });

  test("refuse une action déclarée implantée sans preuve", async () => {
    const decision = await evaluatePolicy({ policy: CORRECTIVE_ACTION_TRANSITION_POLICY, input: { action: "implemented", implementationEvidence: [] }, idempotencyKey: "quality-action-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("quality.implementation_evidence_required");
  });

  test("refuse une vérification d'efficacité sans résultat", async () => {
    const decision = await evaluatePolicy({ policy: CORRECTIVE_ACTION_TRANSITION_POLICY, input: { action: "effectiveness_verified", effectivenessEvidence: [{ id: "test" }] }, idempotencyKey: "quality-action-002" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("quality.effectiveness_result_required");
  });

  test("refuse un audit complété sans conclusion et preuve", async () => {
    const decision = await evaluatePolicy({ policy: AUDIT_TRANSITION_POLICY, input: { action: "completed", evidence: [] }, idempotencyKey: "quality-audit-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("quality.audit_completion_evidence_required");
  });
});
