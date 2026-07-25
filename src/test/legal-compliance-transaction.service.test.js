jest.mock("../../../db", () => ({ pool: { connect: jest.fn(), query: jest.fn() } }));

const { evaluatePolicy } = require("../services/business/transaction-engine.service");
const {
  OBLIGATION_CREATE_POLICY,
  CONTRACT_TRANSITION_POLICY,
  POLICY_PUBLISH_POLICY,
  ACKNOWLEDGE_POLICY,
  ASSESS_POLICY,
  MATTER_TRANSITION_POLICY,
  checksum,
  validSource,
} = require("../services/business/legal-compliance-transaction.service");

describe("legal and compliance transactional core", () => {
  test("refuse une obligation sans source officielle versionnée", async () => {
    const decision = await evaluatePolicy({ policy: OBLIGATION_CREATE_POLICY, input: { code: "QC-001", title: "Obligation", jurisdiction: "QC" }, idempotencyKey: "legal-obligation-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("legal.source_required");
  });

  test("accepte une source traçable et datée", async () => {
    const input = { code: "QC-001", title: "Obligation", jurisdiction: "QC", authority: "Autorité", sourceUrl: "https://example.test/source", version: "2026-01", effectiveFrom: "2026-01-01" };
    expect(validSource(input)).toBe(true);
    const decision = await evaluatePolicy({ policy: OBLIGATION_CREATE_POLICY, input, idempotencyKey: "legal-obligation-002" });
    expect(decision.allowed).toBe(true);
  });

  test("produit une empreinte stable pour une source identique", () => {
    expect(checksum({ version: "1", rules: ["a"] })).toBe(checksum({ version: "1", rules: ["a"] }));
    expect(checksum({ version: "1" })).not.toBe(checksum({ version: "2" }));
  });

  test("refuse la signature d'un contrat sans preuve", async () => {
    const decision = await evaluatePolicy({ policy: CONTRACT_TRANSITION_POLICY, input: { contractId: 1, action: "signed", evidence: [] }, idempotencyKey: "contract-sign-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("legal.signature_evidence_required");
  });

  test("refuse une terminaison sans raison", async () => {
    const decision = await evaluatePolicy({ policy: CONTRACT_TRANSITION_POLICY, input: { contractId: 1, action: "terminated", evidence: [{ id: "notice" }] }, idempotencyKey: "contract-term-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("legal.reason_required");
  });

  test("refuse la publication d'une politique sans approbation prouvée", async () => {
    const decision = await evaluatePolicy({ policy: POLICY_PUBLISH_POLICY, input: { policyId: 1, approvalEvidence: [] }, idempotencyKey: "policy-publish-001" });
    expect(decision.allowed).toBe(false);
  });

  test("refuse une attestation de lecture sans preuve", async () => {
    const decision = await evaluatePolicy({ policy: ACKNOWLEDGE_POLICY, input: { policyId: 1, employeeId: 2, evidence: [] }, idempotencyKey: "policy-ack-001" });
    expect(decision.allowed).toBe(false);
  });

  test("refuse de déclarer conforme sans preuve", async () => {
    const decision = await evaluatePolicy({ policy: ASSESS_POLICY, input: { obligationId: 1, status: "compliant", rationale: "Évaluation réalisée", evidence: [] }, idempotencyKey: "assessment-001" });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("legal.compliance_evidence_required");
  });

  test("autorise un constat non conforme documenté sans inventer une preuve de conformité", async () => {
    const decision = await evaluatePolicy({ policy: ASSESS_POLICY, input: { obligationId: 1, status: "non_compliant", rationale: "Écart observé", evidence: [] }, idempotencyKey: "assessment-002" });
    expect(decision.allowed).toBe(true);
  });

  test("exige une raison pour clore un dossier juridique", async () => {
    const decision = await evaluatePolicy({ policy: MATTER_TRANSITION_POLICY, input: { matterId: 1, action: "closed" }, idempotencyKey: "matter-close-001" });
    expect(decision.allowed).toBe(false);
  });
});