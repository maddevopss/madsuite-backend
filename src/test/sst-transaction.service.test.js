const {
  HAZARD_CREATE_POLICY,
  INCIDENT_REPORT_POLICY,
  ACTION_TRANSITION_POLICY,
  INSPECTION_COMPLETE_POLICY,
  PPE_INSPECT_POLICY,
  riskScore,
  hasEvidence,
} = require("../services/business/sst-transaction.service");
const { evaluatePolicy } = require("../services/business/transaction-engine.service");

describe("sst transactional core", () => {
  test("calcule un score de risque reproductible", () => {
    expect(riskScore(4, 5)).toBe(20);
    expect(riskScore(0, 5)).toBeNull();
    expect(riskScore(2.5, 4)).toBeNull();
  });

  test("refuse un danger incomplet", async () => {
    const decision = await evaluatePolicy({ policy: HAZARD_CREATE_POLICY, input: { title: "Sol glissant" }, idempotencyKey: "hazard-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("sst.hazard_incomplete");
  });

  test("accepte un danger évalué", async () => {
    const decision = await evaluatePolicy({ policy: HAZARD_CREATE_POLICY, input: { title: "Sol glissant", category: "chute", probability: 3, severity: 4 }, idempotencyKey: "hazard-002" });
    expect(decision.allowed).toBe(true);
    expect(decision.riskScore).toBe(12);
  });

  test("refuse un incident sans faits minimaux", async () => {
    const decision = await evaluatePolicy({ policy: INCIDENT_REPORT_POLICY, input: { incidentType: "near_miss" }, idempotencyKey: "incident-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("sst.incident_incomplete");
  });

  test("exige une preuve pour corriger une action", async () => {
    const decision = await evaluatePolicy({ policy: ACTION_TRANSITION_POLICY, input: { actionId: 1, action: "correct", evidence: [] }, idempotencyKey: "action-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("sst.evidence_required");
  });

  test("exige une raison pour fermer une action", async () => {
    const decision = await evaluatePolicy({ policy: ACTION_TRANSITION_POLICY, input: { actionId: 1, action: "close" }, idempotencyKey: "action-002" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("sst.reason_required");
  });

  test("exige des constats quand une inspection échoue", async () => {
    const decision = await evaluatePolicy({ policy: INSPECTION_COMPLETE_POLICY, input: { inspectionId: 1, result: "fail", findings: [] }, idempotencyKey: "inspection-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("sst.findings_required");
  });

  test("exige un constat pour retirer un équipement", async () => {
    const decision = await evaluatePolicy({ policy: PPE_INSPECT_POLICY, input: { assetId: 1, result: "retire" }, idempotencyKey: "ppe-0001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("sst.ppe_findings_required");
  });

  test("détecte la présence d’une preuve", () => {
    expect(hasEvidence([{ type: "photo", id: "proof-1" }])).toBe(true);
    expect(hasEvidence([])).toBe(false);
  });
});
