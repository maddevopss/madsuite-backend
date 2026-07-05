const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const organisationScopedRouters = [
  ["/api/timesheet", "src/routes/timesheet.js"],
  ["/api/clients", "src/routes/clients.js"],
  ["/api/dashboard", "src/routes/dashboard.js"],
  ["/api/projets", "src/routes/projets.js"],
  ["/api/users", "src/routes/users.js"],
  ["/api/reports", "src/routes/reports.js"],
  ["/api/timer", "src/routes/timer.js"],
  ["/api/activity", "src/routes/activity.js"],
  ["/api/invoices", "src/routes/invoices.routes.js"],
  ["/api/billing", "src/routes/billingDashboard.routes.js"],
  ["/api/revenue", "src/routes/revenue.routes.js"],
  ["/api/estimates", "src/routes/estimates.routes.js"],
  ["/api/quotes", "src/routes/quotes.routes.js"],
  ["/api/expenses", "src/routes/expenses.routes.js"],
  ["/api/ai-assistant", "src/routes/aiAssistant.routes.js"],
  ["/api/cognitive", "src/routes/cognitive.routes.js"],
  ["/api/notifications", "src/routes/notifications.routes.js"],
  ["/api/analytics", "src/routes/analytics.routes.js"],
];

const violations = [];

function routeDefinitions(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => /router\.(get|post|put|patch|delete)\(/.test(line));
}

function hasOrganisationMiddleware(source) {
  if (!source.includes("requireOrganisation")) return false;
  if (/router\.use\(\s*requireOrganisation\s*\)/.test(source)) return true;

  const routes = routeDefinitions(source);
  return routes.length > 0 && routes.every((line) => line.includes("requireOrganisation"));
}

for (const [mount, relativeFile] of organisationScopedRouters) {
  const file = path.join(repoRoot, relativeFile);
  if (!fs.existsSync(file)) {
    violations.push(`${mount}: router file missing (${relativeFile})`);
    continue;
  }

  const source = fs.readFileSync(file, "utf8");

  if (!hasOrganisationMiddleware(source)) {
    violations.push(`${mount}: ${relativeFile} must apply requireOrganisation globally or on every route`);
  }
}

if (violations.length > 0) {
  console.error("\nMADSuite organisation route guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  console.error("\nOrganisation-scoped business routes must use the canonical RLS middleware.\n");
  process.exit(1);
}

console.log("Organisation route guard passed.");
