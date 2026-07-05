const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const routesPath = path.join(repoRoot, "src", "routes", "stripe.routes.js");
const servicePath = path.join(repoRoot, "src", "services", "stripe.service.js");
const appPath = path.join(repoRoot, "src", "app.js");

const violations = [];
const routes = fs.existsSync(routesPath) ? fs.readFileSync(routesPath, "utf8") : "";
const service = fs.existsSync(servicePath) ? fs.readFileSync(servicePath, "utf8") : "";
const app = fs.existsSync(appPath) ? fs.readFileSync(appPath, "utf8") : "";

if (!routes) violations.push("src/routes/stripe.routes.js is missing.");
if (!service) violations.push("src/services/stripe.service.js is missing.");
if (!app) violations.push("src/app.js is missing.");

if (app && !app.includes('app.use("/api/stripe", stripeRoutes);')) {
  violations.push("/api/stripe must be mounted before express.json() in src/app.js.");
}

if (routes && !routes.includes("express.raw({ type: \"application/json\" })")) {
  violations.push("Stripe webhook route must use express.raw({ type: \"application/json\" }).");
}

if (routes && !routes.includes("stripe-signature")) {
  violations.push("Stripe webhook route must read the stripe-signature header.");
}

if (routes && !routes.includes("constructEvent(req.body, sig, webhookSecret)")) {
  violations.push("Stripe webhook route must verify the event with constructEvent(req.body, sig, webhookSecret).");
}

if (service && !service.includes("stripeReconciliationService.processWebhookEvent(event)")) {
  violations.push("Stripe webhook handling must pass events through reconciliation/idempotency service.");
}

if (service && !service.includes("client_reference_id")) {
  violations.push("Stripe invoice payments must use client_reference_id to resolve the invoice.");
}

if (service && !service.includes("session.amount_total !== expectedAmount")) {
  violations.push("Stripe invoice payments must verify paid amount against invoice total.");
}

if (service && !service.includes("status IN ('sent', 'draft', 'finalized')")) {
  violations.push("Stripe invoice payment update must allow finalized invoices to become paid.");
}

if (service && !service.includes("AND organisation_id = $2")) {
  violations.push("Stripe invoice payment update must be scoped by organisation_id.");
}

if (service && !service.includes("recordLedgerEntry")) {
  violations.push("Stripe invoice payment must record a ledger entry.");
}

if (service && !service.includes("recordBusinessAudit")) {
  violations.push("Stripe invoice payment must record a business audit event.");
}

if (violations.length > 0) {
  console.error("\nMADSuite Stripe contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Stripe contract guard passed.");
