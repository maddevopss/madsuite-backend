const fs = require("fs");
const path = require("path");

describe("activation du verrou des ajustements comptables", () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, "../routes/business/accounting.routes.js"),
    "utf8",
  );
  const remediationSource = fs.readFileSync(
    path.join(__dirname, "../services/business/accounting-remediation.service.js"),
    "utf8",
  );

  test("les routes utilisent la façade de gouvernance protégée", () => {
    expect(routeSource).toContain(
      'require("../../services/business/accounting-governance-period-guarded.service")',
    );
    expect(routeSource).not.toContain(
      'const accountingGovernanceService = require("../../services/business/accounting-governance.service")',
    );
  });

  test("la route d’ajustement transmet la connexion active", () => {
    const adjustmentRoute = routeSource.slice(
      routeSource.indexOf('router.post("/entries/adjustments"'),
      routeSource.indexOf('router.post("/entries/:id/post"'),
    );
    expect(adjustmentRoute).toContain("db: req.db");
    expect(adjustmentRoute).toContain("accountingGovernanceService.createPostedAdjustment");
  });

  test("les corrections contrôlées utilisent la même façade protégée", () => {
    expect(remediationSource).toContain(
      'require("./accounting-governance-period-guarded.service")',
    );
    expect(remediationSource).toContain("governanceService.createPostedAdjustment({\n    db,");
    expect(remediationSource).not.toContain(
      'const governanceService = require("./accounting-governance.service")',
    );
  });
});
