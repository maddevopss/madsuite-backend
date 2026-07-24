jest.mock("../../db", () => ({ query: jest.fn() }));

const db = require("../../db");
const { getTimeBillingPreview, normalizeTaxRate } = require("../services/invoice/time-billing.service");

describe("time billing preview", () => {
  beforeEach(() => jest.clearAllMocks());

  test("calcule les heures, taxes et total depuis les entrées filtrées", async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          id: 11,
          projet_id: 4,
          projet_nom: "Migration",
          client_id: 8,
          client_nom: "Client Alpha",
          description: "Analyse",
          start_time: "2026-07-01T13:00:00.000Z",
          end_time: "2026-07-01T15:00:00.000Z",
          billing_increment: 15,
          billing_rounding_type: "nearest",
          hourly_rate_used: "100.00",
        },
      ],
    });

    const preview = await getTimeBillingPreview({
      organisationId: 3,
      clientId: 8,
      projectId: 4,
      from: "2026-07-01",
      to: "2026-07-31",
      taxRate: 15,
    });

    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0]).toMatchObject({ hours: 2, hourly_rate_used: 100, amount: 200 });
    expect(preview.summary).toEqual({
      entry_count: 1,
      total_hours: 2,
      subtotal: 200,
      tax_rate: 15,
      tax_total: 30,
      total: 230,
      currency: "CAD",
    });
    expect(db.query.mock.calls[0][1]).toEqual([3, 8, 4, "2026-07-01", "2026-07-31"]);
  });

  test("retourne un aperçu vide cohérent", async () => {
    db.query.mockResolvedValue({ rows: [] });
    const preview = await getTimeBillingPreview({ organisationId: 3, clientId: 8 });
    expect(preview.entries).toEqual([]);
    expect(preview.summary.total).toBe(0);
    expect(preview.summary.entry_count).toBe(0);
  });

  test("refuse un taux de taxe invalide", () => {
    expect(() => normalizeTaxRate(101)).toThrow("Taux de taxe invalide");
    expect(() => normalizeTaxRate(-1)).toThrow("Taux de taxe invalide");
  });
});
