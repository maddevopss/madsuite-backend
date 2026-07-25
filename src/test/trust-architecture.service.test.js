const {
  buildTrustAssessment,
  createGraphEdge,
  createCognitiveContext,
  createAgentIntent,
  createSimulation,
  createInstitutionalMemoryEntry,
} = require("../services/business/trust-architecture.service");

describe("architecture de confiance phases E à L", () => {
  test("calcule un constat MADTrust explicable", () => {
    const assessment = buildTrustAssessment({
      transactionId: "CTM-2026-test",
      organisationId: 42,
      checks: [
        { code: "entry.balanced", passed: true },
        { code: "projection.current", passed: false, severity: "warning", explanation: "Retard de projection" },
      ],
    });
    expect(assessment.score).toBe(95);
    expect(assessment.status).toBe("attention");
    expect(assessment.checks[1].explanation).toBe("Retard de projection");
  });

  test("construit une relation métier avec provenance", () => {
    expect(createGraphEdge({
      organisationId: 42,
      from: { type: "invoice", id: 10 },
      to: { type: "payment", id: 11 },
      relation: "settled_by",
      provenance: { eventId: 99 },
    })).toMatchObject({ from: { type: "invoice", id: "10" }, to: { type: "payment", id: "11" } });
  });

  test("préserve le contexte cognitif sans exécuter d’action", () => {
    const context = createCognitiveContext({ objective: "Finaliser la facture", currentStep: "validation", nextAction: "corriger les taxes" });
    expect(context.nextAction).toBe("corriger les taxes");
  });

  test("une intention d’agent reste une proposition", () => {
    const intent = createAgentIntent({ agentId: "billing-agent", action: "préparer un rappel", justification: "facture échue" });
    expect(intent).toMatchObject({ status: "proposed", requiresApproval: true });
  });

  test("une simulation est explicitement isolée", () => {
    const simulation = createSimulation({ organisationId: 42, name: "hausse tarifaire", baseVersion: "event:100" });
    expect(simulation.status).toBe("isolated");
  });

  test("la mémoire institutionnelle est append-only par contrat", () => {
    const memory = createInstitutionalMemoryEntry({ decision: "Adopter CTMAD", context: "Résolution de gouvernance" });
    expect(memory.immutable).toBe(true);
  });
});
