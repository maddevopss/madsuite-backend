const db = require("../../db");
const metricsAggregationJob = require("../jobs/metricsAggregationJob");

jest.mock("../../db", () => {
  const queryMock = jest.fn();
  return {
    query: queryMock,
    pool: { 
      connect: jest.fn()
    }
  };
});

describe("MetricsAggregationJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("devrait retourner les métriques correctement aggrégées", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        total_active_orgs: "100",
        activation_rate: "80.5",
        first_invoice_sent_rate: "50.0",
        first_payment_rate: "25.0",
        recurring_adoption_rate: "10.0",
        quote_conversion_rate: "40.0",
        invoice_paid_after_dunning_rate: "15.0"
      }]
    });

    // Mock pour calculateTimeToFirstInvoice
    db.query.mockResolvedValueOnce({
      rows: [{
        avg_minutes: "120.5",
        sample_size: "50"
      }]
    });

    const metrics = await metricsAggregationJob.calculateMetrics(30);

    expect(db.query).toHaveBeenCalledTimes(2);
    expect(metrics).toEqual({
      monthly_active_accounts: 100,
      activation_rate: 80.5,
      first_invoice_sent_rate: 50.0,
      first_payment_rate: 25.0,
      recurring_adoption_rate: 10.0,
      quote_conversion_rate: 40.0,
      invoice_paid_after_dunning_rate: 15.0,
      ttfi_minutes: 120.5,
      ttfi_sample_size: 50
    });
  });

  it("devrait exécuter la fonction run par défaut pour 30 jours", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        total_active_orgs: "100",
        activation_rate: "80.5",
        first_invoice_sent_rate: "50.0",
        first_payment_rate: "25.0",
        recurring_adoption_rate: "10.0",
        quote_conversion_rate: "40.0",
        invoice_paid_after_dunning_rate: "15.0"
      }]
    });

    // Mock pour calculateTimeToFirstInvoice
    db.query.mockResolvedValueOnce({
      rows: [{
        avg_minutes: "120.5",
        sample_size: "50"
      }]
    });

    const metrics = await metricsAggregationJob.run();

    expect(db.query).toHaveBeenCalledWith(expect.any(String), [30]);
    expect(metrics.monthly_active_accounts).toBe(100);
    expect(metrics.ttfi_minutes).toBe(120.5);
    expect(metrics.ttfi_sample_size).toBe(50);
  });
});
