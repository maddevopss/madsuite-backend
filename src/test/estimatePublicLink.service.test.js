const {
  hashPublicToken,
  isValidPublicEstimateToken,
  buildPublicEstimateDocument,
} = require("../services/estimate/estimate-public-link.service");

jest.mock("../../db", () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock("../services/auditLog.service", () => ({
  recordBusinessAudit: jest.fn(),
}));

jest.mock("../services/estimate/estimate-query.service", () => ({
  getEstimateById: jest.fn(),
}));

describe("estimate-public-link.service", () => {
  test("accepte seulement un jeton opaque de 256 bits", () => {
    const token = "A".repeat(43);
    expect(isValidPublicEstimateToken(token)).toBe(true);
    expect(isValidPublicEstimateToken("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
    expect(isValidPublicEstimateToken("court")).toBe(false);
  });

  test("stocke une empreinte SHA-256 déterministe", () => {
    const hash = hashPublicToken("A".repeat(43));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashPublicToken("A".repeat(43)));
    expect(hash).not.toBe(hashPublicToken("B".repeat(43)));
  });

  test("construit un document public sans identifiants internes", () => {
    const document = buildPublicEstimateDocument({
      id: 99,
      organisation_id: 12,
      client_id: 7,
      public_token: "ancien-uuid",
      estimate_number: "SOU-2026-0042",
      status: "accepted",
      issue_date: "2026-07-24",
      valid_until: "2026-08-24",
      subtotal: "100.00",
      tax_total: "14.98",
      total: "114.98",
      notes: "Travaux proposés",
      client_nom: "Client Test",
      items: [{
        id: 3,
        organisation_id: 12,
        estimate_id: 99,
        description: "Développement",
        quantity: "2.00",
        unit_rate: "50.00",
        amount: "100.00",
      }],
    }, {
      decision: "accepted",
      signer_name: "Client Test",
      decided_at: "2026-07-24T18:00:00Z",
    });

    expect(document).toMatchObject({
      estimate_number: "SOU-2026-0042",
      client: { name: "Client Test" },
      decision: { value: "accepted", signer_name: "Client Test" },
    });
    expect(document).not.toHaveProperty("id");
    expect(document).not.toHaveProperty("organisation_id");
    expect(document).not.toHaveProperty("client_id");
    expect(document).not.toHaveProperty("public_token");
    expect(document.items[0]).not.toHaveProperty("estimate_id");
  });
});