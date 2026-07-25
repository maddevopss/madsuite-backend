const { evaluatePolicy } = require("../services/business/transaction-engine.service");
require("../services/business/environmental-management-transaction.service");

const key = "environment-test-key";
const evaluate = (policy, input) => evaluatePolicy({ policy, input, idempotencyKey: key });

const expectDenied = async (policy, input, code) => {
  const result = await evaluate(policy, input);
  expect(result.allowed).toBe(false);
  expect(result.code).toBe(code);
};

describe("environmental management transaction policies", () => {
  test("refuse un permis sans preuve", async () => {
    await expectDenied("environment.permit.register@1", {
      permitType: "air", permitNumber: "P-1", issuingAuthority: "Autorité", issuedAt: "2026-01-01", expiresAt: "2027-01-01", proofRefs: [],
    }, "environment.permit_proof_required");
  });

  test("refuse un incident daté dans le futur", async () => {
    await expectDenied("environment.incident.report@1", {
      siteId: 1, occurredAt: "2999-01-01", incidentType: "spill", severity: "high", description: "Déversement", responsibleUserId: 2, proofRefs: ["proof-1"],
    }, "environment.incident_future_date");
  });

  test("refuse une inspection future", async () => {
    await expectDenied("environment.inspection.complete@1", {
      siteId: 1, inspectedAt: "2999-01-01", inspectorUserId: 4, scope: ["water"], findings: [], proofRefs: ["proof-2"],
    }, "environment.inspection_future_date");
  });

  test("refuse la fermeture d'une action sans preuve", async () => {
    await expectDenied("environment.corrective_action.close@1", {
      actionId: 10, closedBy: 3, closureEvidence: [],
    }, "environment.action_closure_proof_required");
  });

  test("refuse une mesure sans source", async () => {
    await expectDenied("environment.metric.record@1", {
      metricType: "energy", periodStart: "2026-01-01", periodEnd: "2026-01-31", value: 12.5, unit: "kWh", methodology: "meter", sourceRefs: [],
    }, "environment.metric_source_required");
  });

  test("refuse l'auto-approbation d'un rapport", async () => {
    await expectDenied("environment.report.publish@1", {
      periodStart: "2026-01-01", periodEnd: "2026-12-31", summary: "Rapport", indicators: {}, risks: [], proofRefs: ["proof-3"], preparedBy: 7, approvedBy: 7,
    }, "environment.report_independent_approval_required");
  });

  test("accepte un rapport complet approuvé indépendamment", async () => {
    const result = await evaluate("environment.report.publish@1", {
      periodStart: "2026-01-01", periodEnd: "2026-12-31", summary: "Rapport", indicators: { emissions: 100 }, risks: [], proofRefs: ["proof-4"], preparedBy: 7, approvedBy: 8,
    });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe("environment.report_publish_allowed");
  });
});
