const { evaluatePolicy } = require("../services/business/transaction-engine.service");
require("../services/business/environmental-management-transaction.service");

const key = "environment-test-key";
const evaluate = (policy, input) => evaluatePolicy({ policy, input, idempotencyKey: key });

const expectCode = async (promise, code) => {
  await expect(promise).rejects.toMatchObject({ code });
};

describe("environmental management transaction policies", () => {
  test("refuse un permis sans preuve", async () => {
    await expectCode(evaluate("environment.permit.register@1", {
      permitType: "air", permitNumber: "P-1", issuingAuthority: "Autorité", issuedAt: "2026-01-01", expiresAt: "2027-01-01", proofRefs: [],
    }), "ENVIRONMENT_PERMIT_PROOF_REQUIRED");
  });

  test("refuse un incident daté dans le futur", async () => {
    await expectCode(evaluate("environment.incident.report@1", {
      siteId: 1, occurredAt: "2999-01-01", incidentType: "spill", severity: "high", description: "Déversement", responsibleUserId: 2, proofRefs: ["proof-1"],
    }), "ENVIRONMENT_INCIDENT_FUTURE_DATE");
  });

  test("refuse une inspection future", async () => {
    await expectCode(evaluate("environment.inspection.complete@1", {
      inspectedAt: "2999-01-01", inspectorUserId: 4, scope: ["water"], findings: [], proofRefs: ["proof-2"],
    }), "ENVIRONMENT_INSPECTION_FUTURE_DATE");
  });

  test("refuse la fermeture d'une action sans preuve", async () => {
    await expectCode(evaluate("environment.corrective_action.close@1", {
      actionId: 10, closedBy: 3, closureEvidence: [],
    }), "ENVIRONMENT_ACTION_CLOSURE_PROOF_REQUIRED");
  });

  test("refuse une mesure sans source", async () => {
    await expectCode(evaluate("environment.metric.record@1", {
      metricType: "energy", periodStart: "2026-01-01", periodEnd: "2026-01-31", value: 12.5, unit: "kWh", methodology: "meter", sourceRefs: [],
    }), "ENVIRONMENT_METRIC_SOURCE_REQUIRED");
  });

  test("refuse l'auto-approbation d'un rapport", async () => {
    await expectCode(evaluate("environment.report.publish@1", {
      periodStart: "2026-01-01", periodEnd: "2026-12-31", summary: "Rapport", indicators: {}, risks: [], proofRefs: ["proof-3"], preparedBy: 7, approvedBy: 7,
    }), "ENVIRONMENT_REPORT_SELF_APPROVAL");
  });

  test("accepte un rapport complet approuvé indépendamment", async () => {
    await expect(evaluate("environment.report.publish@1", {
      periodStart: "2026-01-01", periodEnd: "2026-12-31", summary: "Rapport", indicators: { emissions: 100 }, risks: [], proofRefs: ["proof-4"], preparedBy: 7, approvedBy: 8,
    })).resolves.toBeDefined();
  });
});
