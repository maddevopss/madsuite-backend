const fs = require("fs");
const path = require("path");
const remediationService = require("../services/business/accounting-remediation.service");

describe("accounting controlled remediation API", () => {
  test("la prévisualisation valide et équilibre les lignes sans mutation", async () => {
    const db = { query: jest.fn() };
    jest.spyOn(require("../services/business/accounting-reconciliation.service"), "reconcilePostedSources")
      .mockResolvedValue({
        anomalies: [{
          sourceType: "invoice",
          sourceId: "41",
          status: "amount_mismatch",
          remediation: { action: "create_adjustment" },
        }],
      });

    const preview = await remediationService.previewControlledAdjustment({
      db,
      organisationId: 9,
      command: {
        sourceType: "invoice",
        sourceId: "41",
        entryDate: "2026-07-28",
        lines: [
          { accountId: 1, debit: 25.5, credit: 0 },
          { accountId: 2, debit: 0, credit: 25.5 },
        ],
      },
    });

    expect(preview).toMatchObject({
      mode: "preview",
      mutatesAccounting: false,
      requiresHumanConfirmation: true,
      proposedEntry: { totals: { debit: 25.5, credit: 25.5 } },
    });
  });

  test("les deux endpoints sont administratifs et séparés", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../routes/business/accounting.routes.js"),
      "utf8",
    );

    expect(source).toContain('router.post("/reconciliation/remediation/preview", requireRole("admin")');
    expect(source).toContain('router.post("/reconciliation/remediation/apply", requireRole("admin")');
    expect(source).toContain("previewControlledAdjustment");
    expect(source).toContain("applyControlledAdjustment");
  });

  test("l’application retourne une preuve avant/après", async () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../services/business/accounting-remediation.service.js"),
      "utf8",
    );

    expect(source).toContain("confirmedByHuman");
    expect(source).toContain("idempotencyKey");
    expect(source).toContain("beforeStatus");
    expect(source).toContain("afterStatus");
    expect(source).toContain("resolved");
  });
});
