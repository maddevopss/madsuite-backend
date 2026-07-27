const fs = require("fs");
const path = require("path");

describe("accounting trial balance HTTP contract", () => {
  const routePath = path.join(__dirname, "../routes/business/accounting.routes.js");
  const source = fs.readFileSync(routePath, "utf8");

  test("raccorde GET /trial-balance au service comparatif", () => {
    expect(source).toContain('require("../../services/business/accounting-trial-balance.service")');
    expect(source).toContain('router.get("/trial-balance"');
    expect(source).toContain("accountingTrialBalanceService.getComparativeTrialBalance");
  });

  test.each([
    "req.query.startDate",
    "req.query.endDate",
    "req.query.previousStartDate",
    "req.query.previousEndDate",
  ])("transmet le paramètre %s", (parameter) => {
    expect(source).toContain(parameter);
  });

  test("retourne directement la balance structurée", () => {
    expect(source).toContain("return res.json(result)");
    expect(source).not.toContain("res.json({ rows });\n  } catch (error) { next(error); }\n});\n\nrouter.get(\"/statements\"");
  });
});
