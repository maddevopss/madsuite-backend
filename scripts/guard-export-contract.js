const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const routePath = path.join(repoRoot, "src", "integrations", "export", "export.routes.js");
const servicePath = path.join(repoRoot, "src", "integrations", "export", "export.service.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const route = read(routePath);
const service = read(servicePath);

if (!app) violations.push("src/app.js is missing.");
if (!route) violations.push("src/integrations/export/export.routes.js is missing.");
if (!service) violations.push("src/integrations/export/export.service.js is missing.");

if (app && !app.includes('app.use("/api/integrations/export", auth, exportRoutes)')) {
  violations.push("/api/integrations/export must be mounted behind auth in app.js.");
}

if (route && !route.includes("requireOrganisation")) {
  violations.push("export routes must require organisation context.");
}

if (route && !route.includes("getOrganisationId(req)")) {
  violations.push("export routes must use canonical getOrganisationId(req).");
}

if (route && route.includes("req.user.organisation_id")) {
  violations.push("export routes must not use req.user.organisation_id directly.");
}

if (route && !route.includes("parseExportDateRange")) {
  violations.push("export routes must validate export date ranges.");
}

if (route && !route.includes("/^\\d{4}-\\d{2}-\\d{2}$/")) {
  violations.push("export date validation must enforce YYYY-MM-DD format.");
}

if (route && !route.includes("startDate doit être avant ou égale à endDate")) {
  violations.push("export routes must reject inverted date ranges.");
}

if (route && !route.includes("recordBusinessAudit")) {
  violations.push("export routes must record business audit events.");
}

if (route && !route.includes("text/csv; charset=utf-8")) {
  violations.push("export routes must set CSV content type.");
}

if (route && !route.includes("Content-Disposition")) {
  violations.push("export routes must set attachment Content-Disposition.");
}

if (service && !service.includes("organisationValue(organisationId)")) {
  violations.push("export service must normalize organisationId with organisationValue.");
}

if (service && !service.includes("i.organisation_id = $1")) {
  violations.push("invoice export must filter invoices by organisation_id.");
}

if (service && !service.includes("e.organisation_id = $1")) {
  violations.push("expense export must filter expenses by organisation_id.");
}

if (service && !service.includes("organisation_id = $1")) {
  violations.push("ledger export must filter ledger by organisation_id.");
}

if (service && !service.includes("c.organisation_id = $1")) {
  violations.push("export joins to clients must be scoped by organisation_id.");
}

if (service && !service.includes("p.organisation_id = $1")) {
  violations.push("export joins to projects must be scoped by organisation_id.");
}

if (service && !service.includes("deleted_at IS NULL")) {
  violations.push("exports must exclude soft-deleted records where supported.");
}

if (violations.length > 0) {
  console.error("\nMADSuite export contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Export contract guard passed.");
