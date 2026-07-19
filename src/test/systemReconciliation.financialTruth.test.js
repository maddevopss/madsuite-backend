const mockQuery = jest.fn();
const mockRecordFailure = jest.fn();
const mockRecordSuccess = jest.fn();
const mockResolveStatus = jest.fn(() => "warning");

jest.mock("../../db", () => ({
  pool: { query: (...args) => mockQuery(...args) },
}));

jest.mock("../config/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../jobs/jobResultAggregator", () => ({
  createJobResultTracker: () => ({
    recordFailure: (...args) => mockRecordFailure(...args),
    recordSuccess: (...args) => mockRecordSuccess(...args),
    resolveStatus: (...args) => mockResolveStatus(...args),
  }),
}));

const { runSystemReconciliation } = require("../jobs/systemReconciliationJob");

function cleanRevenueRows() {
  return [
    {
      analytics_count: "0",
      db_count: "0",
      analytics_without_db: "0",
      db_without_analytics: "0",
    },
    {
      analytics_count: "0",
      db_count: "0",
      analytics_without_db: "0",
    },
  ];
}

describe("System Reconciliation — vérité financière P0", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveStatus.mockReturnValue("warning");
  });

  test("signale une facture payée sans paiement Stripe adossé au ledger", async () => {
    const [subscriptionTruth, invoiceTruth] = cleanRevenueRows();

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ledger imbalance
      .mockResolvedValueOnce({ rows: [] }) // webhook mismatch
      .mockResolvedValueOnce({
        rows: [
          {
            invoice_id: 41,
            organisation_id: 7,
            status: "paid",
          },
        ],
      }) // paid without successful payment+ledger
      .mockResolvedValueOnce({ rows: [] }) // payment state drift
      .mockResolvedValueOnce({ rows: [subscriptionTruth] })
      .mockResolvedValueOnce({ rows: [invoiceTruth] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // report insert

    const result = await runSystemReconciliation();

    expect(result.report.anomalies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "DATA_DRIFT",
          reference_id: 41,
          organisation_id: 7,
          expected: "successful_payment_with_ledger",
        }),
      ]),
    );
    expect(mockRecordFailure).toHaveBeenCalledTimes(1);
  });

  test("signale un paiement réussi dont la facture demeure impayée", async () => {
    const [subscriptionTruth, invoiceTruth] = cleanRevenueRows();

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            invoice_id: 77,
            organisation_id: 12,
            status: "sent",
            stripe_event_id: "evt_truth_77",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [subscriptionTruth] })
      .mockResolvedValueOnce({ rows: [invoiceTruth] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await runSystemReconciliation();

    expect(result.report.anomalies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "PAYMENT_STATE_DRIFT",
          reference_id: 77,
          event_id: "evt_truth_77",
          expected: "paid",
          actual: "sent",
        }),
      ]),
    );
  });

  test("ne produit aucune anomalie financière pour une chaîne cohérente", async () => {
    const [subscriptionTruth, invoiceTruth] = cleanRevenueRows();
    mockResolveStatus.mockReturnValue("success");

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [subscriptionTruth] })
      .mockResolvedValueOnce({ rows: [invoiceTruth] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await runSystemReconciliation();

    expect(result.report.total_anomalies).toBe(0);
    expect(result.report.version).toBe("1.2.0");
    expect(mockRecordSuccess).toHaveBeenCalledTimes(1);
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });
});
