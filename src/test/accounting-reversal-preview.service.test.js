jest.mock("../services/business/transaction-engine.service", () => ({
  executeTransaction: jest.fn(),
  registerPolicy: jest.fn(),
}));

const {
  validateReversalCommand,
  previewPostedEntryReversal,
} = require("../services/business/accounting-reversal-governance.service");

const command = {
  entryId: 41,
  reversalDate: "2026-07-29",
  reason: "Corriger une écriture publiée par erreur.",
  idempotencyKey: "reverse-entry-41",
  confirmedByHuman: true,
};

test("refuse l’application sans confirmation humaine", () => {
  expect(() => validateReversalCommand({ ...command, confirmedByHuman: false }))
    .toThrow("confirmation humaine explicite");
});

test("prévisualise les lignes inversées sans modifier la comptabilité", async () => {
  const db = {
    query: jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 41,
          entry_number: "VEN-2026-0041",
          entry_date: "2026-07-28",
          description: "Facture 41",
          status: "posted",
          reversed_by_entry_id: null,
          journal_code: "VEN",
          journal_name: "Journal des ventes",
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { accountId: 1100, description: "Client", debit: "0.00", credit: "125.50" },
          { accountId: 4000, description: "Revenu", debit: "125.50", credit: "0.00" },
        ],
      }),
  };

  const result = await previewPostedEntryReversal({
    db,
    organisationId: 7,
    entryId: 41,
    reversalDate: "2026-07-29",
    reason: command.reason,
  });

  expect(result).toMatchObject({
    mode: "preview",
    mutatesAccounting: false,
    requiresHumanConfirmation: true,
    original: { id: 41, status: "posted" },
    proposedReversal: {
      reversalDate: "2026-07-29",
      totals: { debit: 125.5, credit: 125.5 },
    },
  });
  expect(result.proposedReversal.lines).toEqual([
    expect.objectContaining({ accountId: 1100, debit: 0, credit: 125.5 }),
    expect.objectContaining({ accountId: 4000, debit: 125.5, credit: 0 }),
  ]);
  expect(db.query).toHaveBeenCalledTimes(2);
});
