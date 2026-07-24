const {
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  opportunityIdSchema,
  parseOrThrow,
  updateOpportunitySchema,
} = require("../validation/customerGrowth/opportunities.schemas");

describe("customer growth opportunities schemas", () => {
  test("convertit et accepte une création complète", () => {
    const parsed = parseOrThrow(createOpportunitySchema, {
      lead_id: "3",
      owner_user_id: "4",
      title: "  Nouveau mandat  ",
      estimated_value: "12500.50",
      probability: "65",
      expected_close_date: "2026-08-31",
    });

    expect(parsed).toEqual({
      lead_id: 3,
      owner_user_id: 4,
      title: "Nouveau mandat",
      estimated_value: 12500.5,
      probability: 65,
      expected_close_date: "2026-08-31",
    });
  });

  test("refuse une création sans prospect ni client", () => {
    expect(() => parseOrThrow(createOpportunitySchema, { title: "Sans origine" })).toThrow(
      "Données d'opportunité invalides",
    );
  });

  test("refuse organisation_id même avec une création autrement valide", () => {
    expect(() => parseOrThrow(createOpportunitySchema, {
      organisation_id: 999,
      lead_id: 3,
      title: "Tentative inter-organisation",
    })).toThrow("Données d'opportunité invalides");
  });

  test("refuse une probabilité hors limites", () => {
    expect(() => parseOrThrow(createOpportunitySchema, {
      lead_id: 3,
      title: "Probabilité invalide",
      probability: 101,
    })).toThrow("Données d'opportunité invalides");
  });

  test("refuse une valeur estimée négative", () => {
    expect(() => parseOrThrow(createOpportunitySchema, {
      client_id: 2,
      title: "Valeur invalide",
      estimated_value: -1,
    })).toThrow("Données d'opportunité invalides");
  });

  test("refuse une date qui n'est pas ISO", () => {
    expect(() => parseOrThrow(createOpportunitySchema, {
      client_id: 2,
      title: "Date invalide",
      expected_close_date: "31-08-2026",
    })).toThrow("Données d'opportunité invalides");
  });

  test("refuse une mise à jour vide", () => {
    expect(() => parseOrThrow(updateOpportunitySchema, {})).toThrow("Données d'opportunité invalides");
  });

  test("accepte les données nécessaires pour perdre une opportunité", () => {
    expect(parseOrThrow(updateOpportunitySchema, {
      status: "lost",
      lost_reason: "Budget reporté",
    })).toEqual({ status: "lost", lost_reason: "Budget reporté" });
  });

  test("applique les valeurs par défaut de pagination", () => {
    expect(parseOrThrow(listOpportunitiesQuerySchema, {})).toEqual({ limit: 50, offset: 0 });
  });

  test("refuse les filtres inconnus et les limites excessives", () => {
    expect(() => parseOrThrow(listOpportunitiesQuerySchema, { organisation_id: "7" })).toThrow();
    expect(() => parseOrThrow(listOpportunitiesQuerySchema, { limit: "101" })).toThrow();
  });

  test("convertit un identifiant positif et refuse zéro", () => {
    expect(parseOrThrow(opportunityIdSchema, "42")).toBe(42);
    expect(() => parseOrThrow(opportunityIdSchema, "0")).toThrow();
  });

  test("expose un code et les détails Zod sur une erreur", () => {
    try {
      parseOrThrow(createOpportunitySchema, { lead_id: 3, title: "" });
      throw new Error("Le test devait échouer");
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
      expect(error.details).toBeDefined();
    }
  });
});