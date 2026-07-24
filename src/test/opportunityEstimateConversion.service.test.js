const db = require("../../db");
const {
  convertOpportunityToEstimate,
  normalizeIdempotencyKey,
} = require("../services/customerGrowth/opportunityEstimateConversion.service");

jest.mock("../../db", () => ({
  connect: jest.fn(),
}));

describe("opportunityEstimateConversion.service", () => {
  let client;

  beforeEach(() => {
    client = {
      query: jest.fn(),
      release: jest.fn(),
    };
    db.connect.mockResolvedValue(client);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("normalise et valide la clé d'idempotence", () => {
    expect(normalizeIdempotencyKey("  abc-123  ")).toBe("abc-123");
    expect(() => normalizeIdempotencyKey(" ")).toThrow("clé d'idempotence");
    expect(() => normalizeIdempotencyKey("x".repeat(129))).toThrow("clé d'idempotence");
  });

  test("crée atomiquement une soumission et place l'opportunité au statut proposition", async () => {
    const opportunity = {
      id: 7,
      organisation_id: 3,
      client_id: 22,
      status: "qualified",
      title: "Refonte du site",
      description: "Travaux prévus",
      estimated_value: "1000.00",
      produced_estimate_id: null,
      conversion_idempotency_key: null,
    };
    const estimate = { id: 41, organisation_id: 3, client_id: 22, estimate_number: "EST-2026-0001", total: "1149.75" };
    const item = { id: 55, estimate_id: 41, description: "Refonte du site", amount: "1000.00" };
    const convertedOpportunity = { ...opportunity, status: "proposal", produced_estimate_id: 41, conversion_idempotency_key: "opp-7-estimate" };

    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // recherche clé
      .mockResolvedValueOnce({ rows: [opportunity] }) // opportunité verrouillée
      .mockResolvedValueOnce({}) // LOCK TABLE
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [estimate] })
      .mockResolvedValueOnce({ rows: [item] })
      .mockResolvedValueOnce({ rows: [convertedOpportunity] })
      .mockResolvedValueOnce({}); // COMMIT

    const result = await convertOpportunityToEstimate({
      opportunityId: 7,
      organisationId: 3,
      idempotencyKey: "opp-7-estimate",
      taxRate: 14.975,
    });

    expect(result.idempotent).toBe(false);
    expect(result.estimate.id).toBe(41);
    expect(result.estimate.items).toEqual([item]);
    expect(result.opportunity.status).toBe("proposal");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO estimates"), expect.any(Array));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO estimate_items"), expect.any(Array));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("produced_estimate_id"), expect.any(Array));
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("refuse une opportunité non qualifiée et annule la transaction", async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 8, status: "open", client_id: 22 }] })
      .mockResolvedValueOnce({});

    await expect(convertOpportunityToEstimate({
      opportunityId: 8,
      organisationId: 3,
      idempotencyKey: "opp-8-estimate",
    })).rejects.toMatchObject({ code: "OPPORTUNITY_NOT_QUALIFIED", statusCode: 409 });

    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("retourne null pour une opportunité introuvable", async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    await expect(convertOpportunityToEstimate({
      opportunityId: 999,
      organisationId: 3,
      idempotencyKey: "opp-999-estimate",
    })).resolves.toBeNull();
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
