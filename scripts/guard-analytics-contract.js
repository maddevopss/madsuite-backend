const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const routePath = path.join(repoRoot, "src", "routes", "analytics.routes.js");
const servicePath = path.join(repoRoot, "src", "services", "analytics.service.js");
const repositoryPath = path.join(repoRoot, "src", "services", "analytics.repository.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const route = read(routePath);
const service = read(servicePath);
const repository = read(repositoryPath);

if (!app) violations.push("src/app.js is missing.");
if (!route) violations.push("src/routes/analytics.routes.js is missing.");
if (!service) violations.push("src/services/analytics.service.js is missing.");
if (!repository) violations.push("src/services/analytics.repository.js is missing.");

if (app && !app.includes('app.use("/api/analytics", auth, analyticsRoutes)')) {
  violations.push("/api/analytics must be mounted behind auth in app.js.");
}

if (route && !route.includes("requireSuperAdmin")) {
  violations.push("analytics funnel route must require superadmin.");
}

if (route && !route.includes('router.get(\n  "/funnel"') && !route.includes('router.get("/funnel"')) {
  violations.push("analytics funnel route must exist.");
}

if (route && !route.includes("Math.min(90, Math.max(1")) {
  violations.push("analytics funnel days range must be bounded to 1-90 days.");
}

if (route && !route.includes("ALLOWED_FRONTEND_EVENTS")) {
  violations.push("frontend analytics events must be allowlisted.");
}

if (route && !route.includes("getOrganisationId(req)")) {
  violations.push("analytics track route must use canonical getOrganisationId(req).");
}

if (route && route.includes("req.user?.organisation_id")) {
  violations.push("analytics track route must not use req.user.organisation_id directly.");
}

if (route && !route.includes("validateAndSanitizeMetadata")) {
  violations.push("analytics metadata must be validated and sanitized.");
}

if (route && !route.includes("MAX_METADATA_BYTES = 4096")) {
  violations.push("analytics metadata must keep a 4096-byte cap.");
}

if (route && !route.includes("MAX_METADATA_DEPTH = 3")) {
  violations.push("analytics metadata must keep a max depth cap.");
}

if (route && !route.includes("MAX_METADATA_KEYS = 25")) {
  violations.push("analytics metadata must keep a max key count cap.");
}

const criticalEvents = [
  "signup_completed",
  "subscription_active",
  "first_invoice_created",
  "checkout_started",
];

for (const eventName of criticalEvents) {
  if (route && route.includes(`\"${eventName}\"`)) {
    violations.push(`critical analytics event '${eventName}' must not be allowed from frontend track endpoint.`);
  }
}

if (service && !service.includes("if (!organisationId)")) {
  violations.push("analytics service must reject tracking without organisationId.");
}

if (repository && !repository.includes("INSERT INTO analytics_events")) {
  violations.push("analytics repository must own analytics_events inserts.");
}

if (repository && !repository.includes("organisation_id, user_id, event_name, metadata")) {
  violations.push("analytics repository insert must include organisation_id, user_id, event_name, metadata.");
}

if (violations.length > 0) {
  console.error("\nMADSuite analytics contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Analytics contract guard passed.");
