const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const routesPath = path.join(repoRoot, "src", "routes", "portal.routes.js");
const servicePath = path.join(repoRoot, "src", "services", "portal.service.js");
const estimateLinkServicePath = path.join(
  repoRoot,
  "src",
  "services",
  "estimate",
  "estimate-public-link.service.js",
);

const violations = [];
const routes = fs.existsSync(routesPath) ? fs.readFileSync(routesPath, "utf8") : "";
const service = fs.existsSync(servicePath) ? fs.readFileSync(servicePath, "utf8") : "";
const estimateLinks = fs.existsSync(estimateLinkServicePath)
  ? fs.readFileSync(estimateLinkServicePath, "utf8")
  : "";

if (!routes) violations.push("src/routes/portal.routes.js is missing.");
if (!service) violations.push("src/services/portal.service.js is missing.");
if (!estimateLinks) violations.push("estimate-public-link.service.js is missing.");

if (routes && !routes.includes("requireModuleForOrg")) {
  violations.push("portal.routes.js must use requireModuleForOrg for public module checks.");
}

const paymentsModuleChecks = [
  'ensurePortalModule(res, data.organisationId, "payments")',
  'ensurePortalModule(res, context.organisationId, "payments")',
];
if (routes && !paymentsModuleChecks.some((check) => routes.includes(check))) {
  violations.push("POST /:token/checkout must require the payments module before creating Stripe checkout.");
}

const finalizedInvoiceChecks = [
  'data.document.status !== "finalized"',
  'context.invoice.status !== "finalized"',
  '!context.invoice.finalized_at || context.invoice.status !== "sent"',
];
if (routes && !finalizedInvoiceChecks.some((check) => routes.includes(check))) {
  violations.push("POST /:token/checkout must require a finalized and payable invoice before Stripe checkout.");
}

if (routes && !routes.includes("MODULE_NOT_AVAILABLE")) {
  violations.push("portal module denial must use MODULE_NOT_AVAILABLE.");
}

if (service && !service.includes("getPublicEstimateContextByToken")) {
  violations.push("portal.service.js must resolve estimates through the secure estimate link service.");
}
if (service && !service.includes("decidePublicEstimate")) {
  violations.push("portal.service.js must delegate public estimate decisions to the secure service.");
}
if (service && service.includes("public_token = $1")) {
  violations.push("portal.service.js must not resolve public estimates by legacy UUID.");
}

if (estimateLinks && !estimateLinks.includes('crypto.randomBytes(32).toString("base64url")')) {
  violations.push("estimate public links must use 256-bit opaque tokens.");
}
if (estimateLinks && !estimateLinks.includes('createHash("sha256")')) {
  violations.push("estimate public tokens must be stored by SHA-256 fingerprint.");
}
if (estimateLinks && !estimateLinks.includes("consentConfirmed !== true")) {
  violations.push("public estimate acceptance must require explicit consent.");
}
if (estimateLinks && !estimateLinks.includes("estimate_public_decisions")) {
  violations.push("public estimate decisions must be persisted in the canonical decision table.");
}
if (estimateLinks && !estimateLinks.includes("recordBusinessAudit")) {
  violations.push("secure estimate decisions must record a business audit event.");
}

if (violations.length > 0) {
  console.error("\nMADSuite public portal contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Public portal contract guard passed.");
