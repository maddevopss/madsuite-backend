const {
  persistTrustAssessment,
  persistGraphEdges,
} = require("../services/business/trust-persistence.service");

describe("persistance MADTrust et graphe métier", () => {
  test("persiste un constat et chacun de ses contrôles", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    const assessment = await persistTrustAssessment(client, {
      organisationId: 42,
      transactionId: "CTM-2026-test",
      correlationId: "8c621680-c786-4bb6-98dd-886f072fea86",
      checks: [
        { code: "payment.persisted", passed: true, evidence: [{ id: "9" }] },
        { code: "entry.present", passed: false, severity: "warning" },
      ],
    });

    expect(assessment.score).toBe(95);
    expect(assessment.status).toBe("attention");
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.query.mock.calls[0][0]).toContain("INSERT INTO madtrust_assessments");
    expect(client.query.mock.calls[1][0]).toContain("INSERT INTO madtrust_checks");
  });

  test("normalise et persiste les relations du graphe", async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
    };

    const edges = await persistGraphEdges(client, {
      organisationId: 42,
      transactionId: "CTM-2026-test",
      edges: [{
        from: { type: "supplier_bill", id: 41 },
        relation: "settled_by",
        to: { type: "supplier_payment", id: 9 },
        provenance: { eventId: "event-1" },
      }],
    });

    expect(edges).toEqual([{ id: 1 }]);
    expect(client.query.mock.calls[0][1].slice(3, 8)).toEqual([
      "supplier_bill",
      "41",
      "settled_by",
      "supplier_payment",
      "9",
    ]);
  });
});
