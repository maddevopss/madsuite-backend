const fs = require("fs");
const path = require("path");
const {
  linkAdjustmentToSource,
} = require("../services/business/accounting-remediation.service");

describe("accounting remediation source linkage", () => {
  test("rattache l’écriture à la source métier corrigée", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ id: 88, source_type: "accounting_adjustment_invoice", source_id: "41" }],
      }),
    };

    const result = await linkAdjustmentToSource({
      db,
      organisationId: 9,
      adjustment: { entry: { id: 88 } },
      source: { sourceType: "invoice", sourceId: "41" },
    });

    expect(result).toMatchObject({
      id: 88,
      source_type: "accounting_adjustment_invoice",
      source_id: "41",
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE organisation_id = $3 AND id = $4"),
      ["accounting_adjustment_invoice", "41", 9, 88],
    );
  });

  test("le rapprochement inclut les sources sans écriture et les ajustements liés", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../services/business/accounting-reconciliation.service.js"),
      "utf8",
    );

    expect(source).toContain("FULL OUTER JOIN accounting_totals");
    expect(source).toContain("accounting_adjustment_%");
    expect(source).toContain("COUNT(DISTINCT id) FILTER (WHERE NOT is_adjustment)");
    expect(source).toContain("e.source_type NOT LIKE 'accounting_adjustment_%'");
  });
});
