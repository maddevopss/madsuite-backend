const db = require("../../db");
const metricsAggregationJob = require("../jobs/metricsAggregationJob");

jest.mock("../../db", () => {
  const queryMock = jest.fn();

  return {
    query: queryMock,
    pool: {
      connect: jest.fn(),
    },
  };
});

describe("MetricsAggregationJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("devrait retourner les métriques correctement agrégées", async () => {
    db.query
      // Mock pour les métriques funnel principales
      .mockResolvedValueOnce({
        rows: [
          {
            signups: "100",
            onboarding_completed: "80",
            first_invoice: "50",
            checkout_started: "30",
            subscription_active: "25",
          },
        ],
      })
      // Mock pour calculateTimeToFirstInvoice
      .mockResolvedValueOnce({
        rows: [
          {
            avg_minutes: "120.5",
            sample_size: "50",
          },
        ],
      });

    const metrics = await metricsAggregationJob.calculateMetrics(30);

    expect(db.query).toHaveBeenCalledTimes(2);

    expect(metrics).toEqual({
      signups: 100,
      onboarding_completed: 80,
      first_invoice: 50,
      checkout_started: 30,
      subscription_active: 25,
      onboarding_pct: 80,
      first_invoice_pct: 50,
      checkout_pct: 60,
      paid_pct: 25,
      ttfi_minutes: 120.5,
      ttfi_sample_size: 50,
    });
  });

  it("devrait exécuter la fonction run par défaut pour 30 jours", async () => {
    db.query
      // Mock pour les métriques funnel principales
      .mockResolvedValueOnce({
        rows: [
          {
            signups: "100",
            onboarding_completed: "80",
            first_invoice: "50",
            checkout_started: "30",
            subscription_active: "25",
          },
        ],
      })
      // Mock pour calculateTimeToFirstInvoice
      .mockResolvedValueOnce({
        rows: [
          {
            avg_minutes: "120.5",
            sample_size: "50",
          },
        ],
      });

    const metrics = await metricsAggregationJob.run();

    expect(db.query).toHaveBeenCalledWith(expect.any(String), [30]);

    expect(metrics.signups).toBe(100);
    expect(metrics.onboarding_completed).toBe(80);
    expect(metrics.first_invoice).toBe(50);
    expect(metrics.checkout_started).toBe(30);
    expect(metrics.subscription_active).toBe(25);
    expect(metrics.ttfi_minutes).toBe(120.5);
    expect(metrics.ttfi_sample_size).toBe(50);
  });
});