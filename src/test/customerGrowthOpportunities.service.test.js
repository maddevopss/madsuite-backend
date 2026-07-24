jest.mock("../../db", () => ({ query: jest.fn() }));

const db = require("../../db");
const {
  assertTransitionAllowed,
  createOpportunity,
  deleteOpportunity,
  listOpportunities,
  normalizeClosingFields,
  updateOpportunity,
} = require("../services/customerGrowth/opportunities.service");

describe("customer growth opportunities service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("accepte une transition permise", () => {
    expect(() => assertTransitionAllowed("open", "qualified")).not.toThrow();
  });

  test("refuse une transition interdite", () => {
    expect(() => assertTransitionAllowed("open", "won")).toThrow("Transition d'opportunité interdite");
  });

  test("exige un client pour gagner", () => {
    expect(() => normalizeClosingFields({ status: "proposal", client_id: null }, { status: "won" })).toThrow(
      "Un client est requis",
    );
  });

  test("exige un motif de perte", () => {
    expect(() => normalizeClosingFields({ status: "proposal", lost_reason: null }, { status: "lost" })).toThrow(
      "Un motif est requis",
    );
  });

  test("crée une opportunité dans l'organisation fournie", async () => {
    db.query.mockResolvedValue({ rows: [{ id: 12, organisation_id: 7, status: "open" }] });

    const opportunity = await createOpportunity({
      organisationId: 7,
      actorUserId: 4,
      data: { lead_id: 3, title: "Nouveau mandat" },
    });

    expect(opportunity.id).toBe(12);
    expect(db.query.mock.calls[0][1][0]).toBe(7);
    expect(db.query.mock.calls[0][1]).toContain(3);
  });

  test("refuse une création sans prospect ni client", async () => {
    await expect(
      createOpportunity({ organisationId: 7, actorUserId: 4, data: { title: "Sans origine" } }),
    ).rejects.toMatchObject({ code: "OPPORTUNITY_ORIGIN_REQUIRED" });
  });

  test("borne la pagination de la liste", async () => {
    db.query.mockResolvedValue({ rows: [] });

    await listOpportunities({ organisationId: 7, limit: 999, offset: -5 });

    const params = db.query.mock.calls[0][1];
    expect(params).toContain(100);
    expect(params).toContain(0);
  });

  test("met à jour une opportunité en respectant la portée d'organisation", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 8, organisation_id: 7, status: "open", client_id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 8, organisation_id: 7, status: "qualified" }] });

    const result = await updateOpportunity({
      opportunityId: 8,
      organisationId: 7,
      data: { status: "qualified" },
    });

    expect(result.status).toBe("qualified");
    expect(db.query.mock.calls[1][0]).toContain("organisation_id");
  });

  test("supprime logiquement seulement une opportunité non fermée", async () => {
    db.query.mockResolvedValue({ rows: [{ id: 9 }] });

    const deleted = await deleteOpportunity({ opportunityId: 9, organisationId: 7 });

    expect(deleted).toEqual({ id: 9 });
    expect(db.query.mock.calls[0][0]).toContain("status NOT IN ('won', 'lost')");
  });
});
