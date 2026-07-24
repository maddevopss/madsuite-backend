jest.mock("../../db", () => ({ query: jest.fn() }));

const db = require("../../db");
const {
  assertTransitionAllowed,
  createOpportunity,
  deleteOpportunity,
  getOpportunityById,
  listOpportunities,
  normalizeClosingFields,
  updateOpportunity,
} = require("../services/customerGrowth/opportunities.service");

describe("customer growth opportunities service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("transitions métier", () => {
    test.each([
      ["open", "qualified"],
      ["qualified", "proposal"],
      ["proposal", "negotiation"],
      ["proposal", "won"],
      ["negotiation", "lost"],
      ["lost", "open"],
    ])("autorise %s -> %s", (from, to) => {
      expect(() => assertTransitionAllowed(from, to)).not.toThrow();
    });

    test.each([
      ["open", "won"],
      ["won", "open"],
      ["abandoned", "open"],
      ["qualified", "won"],
    ])("refuse %s -> %s avec le bon code", (from, to) => {
      expect(() => assertTransitionAllowed(from, to)).toThrow(
        expect.objectContaining({ statusCode: 409, code: "OPPORTUNITY_TRANSITION_NOT_ALLOWED" }),
      );
    });
  });

  describe("fermeture et réouverture", () => {
    test("gagner exige un client et ne produit aucune date autrement", () => {
      expect(() => normalizeClosingFields({ status: "proposal", client_id: null }, { status: "won" })).toThrow(
        expect.objectContaining({ statusCode: 400, code: "OPPORTUNITY_CLIENT_REQUIRED" }),
      );
    });

    test("gagner renseigne won_at et closed_at avec le même instant", () => {
      const result = normalizeClosingFields({ status: "proposal", client_id: 42 }, { status: "won" });

      expect(result.won_at).toBeInstanceOf(Date);
      expect(result.closed_at).toBe(result.won_at);
    });

    test("perdre exige un motif", () => {
      expect(() => normalizeClosingFields({ status: "proposal", lost_reason: null }, { status: "lost" })).toThrow(
        expect.objectContaining({ statusCode: 400, code: "OPPORTUNITY_LOST_REASON_REQUIRED" }),
      );
    });

    test("abandonner exige un motif", () => {
      expect(() =>
        normalizeClosingFields({ status: "proposal", abandoned_reason: null }, { status: "abandoned" }),
      ).toThrow(expect.objectContaining({ statusCode: 400, code: "OPPORTUNITY_ABANDONED_REASON_REQUIRED" }));
    });

    test("réouvrir une perte efface les champs de fermeture", () => {
      const result = normalizeClosingFields(
        { status: "lost", closed_at: new Date(), won_at: null },
        { status: "open" },
      );

      expect(result).toMatchObject({ status: "open", closed_at: null, won_at: null });
    });
  });

  describe("requêtes et isolation par organisation", () => {
    test("crée une opportunité avec l’organisation, l’acteur et tous les champs dans l’ordre exact", async () => {
      db.query.mockResolvedValue({ rows: [{ id: 12, organisation_id: 7, status: "open" }] });

      const opportunity = await createOpportunity({
        organisationId: 7,
        actorUserId: 4,
        data: {
          lead_id: 3,
          client_id: null,
          owner_user_id: 8,
          title: "Nouveau mandat",
          description: "Refonte",
          estimated_value: 12500,
          probability: 60,
          expected_close_date: "2026-09-30",
        },
      });

      expect(opportunity).toEqual({ id: 12, organisation_id: 7, status: "open" });
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query.mock.calls[0][1]).toEqual([
        7,
        3,
        null,
        8,
        4,
        "Nouveau mandat",
        "Refonte",
        12500,
        60,
        "2026-09-30",
      ]);
    });

    test("refuse une création sans origine avant toute requête SQL", async () => {
      await expect(
        createOpportunity({ organisationId: 7, actorUserId: 4, data: { title: "Sans origine" } }),
      ).rejects.toMatchObject({ statusCode: 400, code: "OPPORTUNITY_ORIGIN_REQUIRED" });

      expect(db.query).not.toHaveBeenCalled();
    });

    test("liste avec filtres et pagination bornée dans les paramètres exacts", async () => {
      db.query.mockResolvedValue({ rows: [{ id: 1 }] });

      const rows = await listOpportunities({
        organisationId: 7,
        status: "proposal",
        ownerUserId: 8,
        limit: 999,
        offset: -5,
      });

      expect(rows).toEqual([{ id: 1 }]);
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query.mock.calls[0][1]).toEqual([7, "proposal", 8, 100, 0]);
      expect(db.query.mock.calls[0][0]).toContain("sales_opportunities.organisation_id");
      expect(db.query.mock.calls[0][0]).toContain("status = $2");
      expect(db.query.mock.calls[0][0]).toContain("owner_user_id = $3");
    });

    test("cherche une opportunité avec id et organisation exacts", async () => {
      db.query.mockResolvedValue({ rows: [{ id: 8, organisation_id: 7 }] });

      const result = await getOpportunityById({ opportunityId: 8, organisationId: 7 });

      expect(result).toEqual({ id: 8, organisation_id: 7 });
      expect(db.query.mock.calls[0][1]).toEqual([8, 7]);
      expect(db.query.mock.calls[0][0]).toContain("id = $1");
      expect(db.query.mock.calls[0][0]).toContain("sales_opportunities.organisation_id = $2");
    });

    test("retourne null quand l’opportunité n’existe pas dans cette organisation", async () => {
      db.query.mockResolvedValue({ rows: [] });

      await expect(getOpportunityById({ opportunityId: 8, organisationId: 99 })).resolves.toBeNull();
      expect(db.query.mock.calls[0][1]).toEqual([8, 99]);
    });

    test("met à jour une transition et conserve l’organisation dans la lecture et l’écriture", async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 8, organisation_id: 7, status: "open", client_id: 2 }] })
        .mockResolvedValueOnce({ rows: [{ id: 8, organisation_id: 7, status: "qualified" }] });

      const result = await updateOpportunity({
        opportunityId: 8,
        organisationId: 7,
        data: { status: "qualified", probability: 75 },
      });

      expect(result.status).toBe("qualified");
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query.mock.calls[0][1]).toEqual([8, 7]);
      expect(db.query.mock.calls[1][1]).toEqual(["qualified", 75, 8, 7]);
      expect(db.query.mock.calls[1][0]).toContain("status = $1");
      expect(db.query.mock.calls[1][0]).toContain("probability = $2");
      expect(db.query.mock.calls[1][0]).toContain("sales_opportunities.organisation_id = $4");
    });

    test("refuse une transition interdite avant la requête UPDATE", async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 8, organisation_id: 7, status: "open", client_id: 2 }] });

      await expect(
        updateOpportunity({ opportunityId: 8, organisationId: 7, data: { status: "won" } }),
      ).rejects.toMatchObject({ code: "OPPORTUNITY_TRANSITION_NOT_ALLOWED" });

      expect(db.query).toHaveBeenCalledTimes(1);
    });

    test("retourne null sans tenter d’UPDATE quand l’opportunité est absente", async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        updateOpportunity({ opportunityId: 404, organisationId: 7, data: { title: "Introuvable" } }),
      ).resolves.toBeNull();

      expect(db.query).toHaveBeenCalledTimes(1);
    });

    test("supprime logiquement avec id et organisation exacts", async () => {
      db.query.mockResolvedValue({ rows: [{ id: 9 }] });

      const deleted = await deleteOpportunity({ opportunityId: 9, organisationId: 7 });

      expect(deleted).toEqual({ id: 9 });
      expect(db.query.mock.calls[0][1]).toEqual([9, 7]);
      expect(db.query.mock.calls[0][0]).toContain("deleted_at = CURRENT_TIMESTAMP");
      expect(db.query.mock.calls[0][0]).toContain("status NOT IN ('won', 'lost')");
      expect(db.query.mock.calls[0][0]).toContain("sales_opportunities.organisation_id = $2");
    });

    test("retourne null lorsque la suppression logique ne touche aucune ligne", async () => {
      db.query.mockResolvedValue({ rows: [] });

      await expect(deleteOpportunity({ opportunityId: 9, organisationId: 7 })).resolves.toBeNull();
    });
  });
});
