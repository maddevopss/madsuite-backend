const fs = require("fs");
const path = require("path");

describe("contrat des routes comptables protégées", () => {
  const routePath = path.join(__dirname, "../routes/business/accounting.routes.js");
  const source = fs.readFileSync(routePath, "utf8");

  test("utilise la façade protégée par période", () => {
    expect(source).toContain('require("../../services/business/accounting-period-guarded.service")');
  });

  test("ne rebranche pas directement le service comptable non protégé", () => {
    expect(source).not.toContain('const accountingService = require("../../services/business/accounting.service")');
  });

  test("conserve les routes de création et publication sur la même façade", () => {
    expect(source).toContain("accountingService.createEntry");
    expect(source).toContain("accountingService.postEntry");
  });
});
