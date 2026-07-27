const fs = require("fs");
const path = require("path");

const routePath = path.join(__dirname, "../routes/business/accounting.routes.js");
const routeSource = fs.readFileSync(routePath, "utf8");

describe("route HTTP du grand livre comptable", () => {
  test("utilise le service de grand livre traçable", () => {
    expect(routeSource).toContain('require("../../services/business/accounting-ledger.service")');
    expect(routeSource).toContain('router.get("/ledger"');
    expect(routeSource).toContain("accountingLedgerService.getLedger");
  });

  test.each([
    "accountId",
    "startDate",
    "endDate",
    "sourceType",
    "sourceId",
    "projectId",
    "clientId",
    "supplierId",
  ])("transmet le filtre %s", (filterName) => {
    expect(routeSource).toContain(`${filterName}: req.query.${filterName}`);
  });

  test("retourne le document structuré plutôt qu’une ancienne liste plate", () => {
    const ledgerRoute = routeSource.slice(
      routeSource.indexOf('router.get("/ledger"'),
      routeSource.indexOf('router.get("/trial-balance"'),
    );
    expect(ledgerRoute).toContain("return res.json(ledger)");
    expect(ledgerRoute).not.toContain("res.json({ rows })");
  });
});
