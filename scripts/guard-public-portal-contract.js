const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const routesPath = path.join(repoRoot, "src", "routes", "portal.routes.js");
const servicePath = path.join(repoRoot, "src", "services", "portal.service.js");

const violations = [];
const routes = fs.existsSync(routesPath) ? fs.readFileSync(routesPath, "utf8") : "";
const service = fs.existsSync(servicePath) ? fs.readFileSync(servicePath, "utf8") : "";

if (!routes) {
  violations.push("src/routes/portal.routes.js is missing.");
}

if (!service) {
  violations.push("src/services/portal.service.js is missing.");
}

if (routes && !routes.includes("requireModuleForOrg")) {
  violations.push("portal.routes.js must use requireModuleForOrg for public module checks.");
}

if (routes && !routes.includes("ensurePortalModule(res, data.organisationId, \"payments\")")) {
  violations.push("POST /:token/checkout must require the payments module before creating Stripe checkout.");
}

if (routes && !routes.includes("data.document.status !== \"finalized\"")) {
  violations.push("POST /:token/checkout must require finalized invoices before payment.");
}

if (routes && !routes.includes("MODULE_NOT_AVAILABLE")) {
  violations.push("portal module denial must use MODULE_NOT_AVAILABLE.");
}

if (service && !service.includes("public_token = $1")) {
  violations.push("portal.service.js must resolve documents by public_token.");
}

if (service && !service.includes("organisation_id")) {
  violations.push("portal.service.js must carry organisation_id through portal document resolution.");
}

if (service && !service.includes("WHERE id = $2 AND organisation_id = $3")) {
  violations.push("Portal estimate action update must be scoped by id and organisation_id.");
}

if (service && !service.includes("recordBusinessAudit")) {
  violations.push("Portal estimate actions must record a business audit event.");
}

if (violations.length > 0) {
  console.error("\nMADSuite public portal contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Public portal contract guard passed.");
