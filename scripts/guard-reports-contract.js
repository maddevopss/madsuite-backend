const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const routePath = path.join(repoRoot, "src", "routes", "reports.js");
const servicePath = path.join(repoRoot, "src", "services", "reports.service.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const route = read(routePath);
const service = read(servicePath);

if (!app) violations.push("src/app.js is missing.");
if (!route) violations.push("src/routes/reports.js is missing.");
if (!service) violations.push("src/services/reports.service.js is missing.");

if (app && !app.includes('app.use("/api/reports", auth, requireModule("reports"), reportsRoutes)')) {
  violations.push("/api/reports must be mounted behind auth and requireModule('reports') in app.js.");
}

if (route && !route.includes("requireOrganisation")) {
  violations.push("reports routes must require organisation context.");
}

if (route && !route.includes("getOrganisationId(req)")) {
  violations.push("reports routes must use canonical getOrganisationId(req).");
}

if (route && !route.includes("parseReportDateRange")) {
  violations.push("reports main route must validate date range.");
}

if (route && !route.includes("/^\\d{4}-\\d{2}-\\d{2}$/")) {
  violations.push("reports date validation must enforce YYYY-MM-DD format.");
}

if (route && !route.includes("date_debut doit être avant ou égale à date_fin")) {
  violations.push("reports route must reject inverted date ranges.");
}

if (route && !route.includes("VALID_GROUP_BY")) {
  violations.push("reports group_by must be allowlisted.");
}

if (route && !route.includes("VALID_BILLED_FILTERS")) {
  violations.push("reports is_billed must be allowlisted.");
}

if (route && !route.includes("parseYear")) {
  violations.push("reports monthly year must be validated.");
}

if (route && !route.includes("CacheService.getCacheKey") && !route.includes("organisationId")) {
  violations.push("reports cache keys must include organisationId.");
}

if (route && !route.includes("process.env.NODE_ENV !== \"production\"")) {
  violations.push("reports debug endpoints must be disabled in production.");
}

if (service && !service.includes("requireOrganisationId(organisationId)")) {
  violations.push("reports service must require organisationId.");
}

if (service && service.includes("hasColumn")) {
  violations.push("reports service must not use schema fallback that can bypass organisation scope.");
}

if (service && !service.includes("organisationScope(\"te\"")) {
  violations.push("reports generateReport must scope time_entries by organisation.");
}

if (service && !service.includes("organisationScope(\"p\"")) {
  violations.push("reports generateReport must scope projects by organisation.");
}

if (service && !service.includes("organisationScope(\"c\"")) {
  violations.push("reports generateReport must scope clients by organisation.");
}

if (service && !service.includes("organisationScope(\"u\"")) {
  violations.push("reports generateReport must scope users by organisation.");
}

if (service && !service.includes("LIMIT 1000")) {
  violations.push("reports generateReport must cap result rows.");
}

if (service && !service.includes("async function getMonthlyData")) {
  violations.push("reports service must implement getMonthlyData used by routes.");
}

if (service && !service.includes("async function getDailyData")) {
  violations.push("reports service must implement getDailyData used by routes.");
}

if (service && !service.includes("te.organisation_id = $1")) {
  violations.push("reports dashboard data must filter time entries by organisation_id.");
}

if (service && !service.includes("p.organisation_id = $1")) {
  violations.push("reports dashboard joins to projects must be organisation-scoped.");
}

if (service && !service.includes("c.organisation_id = $1")) {
  violations.push("reports dashboard joins to clients must be organisation-scoped.");
}

if (service && !service.includes("LIMIT 500")) {
  violations.push("daily report data must cap entries to 500.");
}

if (service && !/WHERE\s+type\s*=\s*\$1\s+AND\s+organisation_id\s*=\s*\$2/.test(service)) {
  violations.push("debug activity logs must be scoped by organisation_id.");
}

if (violations.length > 0) {
  console.error("\nMADSuite reports contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Reports contract guard passed.");
