const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const routesPath = path.join(repoRoot, "src", "routes", "stripe.routes.js");
const processorPath = path.join(repoRoot, "src", "services", "stripeEventProcessor.service.js");
const webhookEventPath = path.join(repoRoot, "src", "services", "stripeWebhookEvent.service.js");
const servicePath = path.join(repoRoot, "src", "services", "stripe.service.js");
const appPath = path.join(repoRoot, "src", "app.js");

const violations = [];
const routes = fs.existsSync(routesPath) ? fs.readFileSync(routesPath, "utf8") : "";
const processor = fs.existsSync(processorPath) ? fs.readFileSync(processorPath, "utf8") : "";
const webhookEvent = fs.existsSync(webhookEventPath) ? fs.readFileSync(webhookEventPath, "utf8") : "";
const service = fs.existsSync(servicePath) ? fs.readFileSync(servicePath, "utf8") : "";
const app = fs.existsSync(appPath) ? fs.readFileSync(appPath, "utf8") : "";

if (!routes) violations.push("src/routes/stripe.routes.js is missing.");
if (!processor) violations.push("src/services/stripeEventProcessor.service.js is missing.");
if (!webhookEvent) violations.push("src/services/stripeWebhookEvent.service.js is missing.");
if (!service) violations.push("src/services/stripe.service.js is missing.");
if (!app) violations.push("src/app.js is missing.");

// Webhook mounting order validation
const webhookPathIndex = app.indexOf('"/api/stripe/webhook"');
const rawBodyIndex = app.indexOf('express.raw({ type: "application/json" })');
const jsonParserIndex = app.indexOf("app.use(express.json())");
const stripeRouterIndex = app.indexOf('app.use("/api/stripe", stripeRoutes.router)');

if (webhookPathIndex < 0) {
  violations.push("Stripe webhook must be mounted explicitly in src/app.js.");
}

if (rawBodyIndex < 0) {
  violations.push('Stripe webhook must use express.raw({ type: "application/json" }) in src/app.js.');
}

if (webhookPathIndex >= 0 && rawBodyIndex >= 0 && rawBodyIndex < webhookPathIndex) {
  violations.push("Stripe raw body middleware must belong to the webhook route.");
}

if (rawBodyIndex >= 0 && jsonParserIndex >= 0 && rawBodyIndex > jsonParserIndex) {
  violations.push("Stripe webhook raw parser must be mounted before express.json().");
}

if (stripeRouterIndex < 0) {
  violations.push("Stripe JSON routes must be mounted in src/app.js.");
}

if (stripeRouterIndex >= 0 && jsonParserIndex >= 0 && stripeRouterIndex < jsonParserIndex) {
  violations.push("Stripe JSON routes must be mounted after express.json().");
}

// Webhook handler validation
if (routes && !routes.includes('req.headers["stripe-signature"]')) {
  violations.push("Stripe webhook route must read the stripe-signature header.");
}

if (routes && !routes.includes("process.env.STRIPE_WEBHOOK_SECRET")) {
  violations.push("Stripe webhook route must use STRIPE_WEBHOOK_SECRET environment variable.");
}

if (routes && !routes.includes("stripe.webhooks.constructEvent(req.body, sig, webhookSecret)")) {
  violations.push("Stripe webhook route must verify the event with constructEvent(req.body, sig, webhookSecret).");
}

// Idempotency validation
if (routes && !routes.includes("stripeWebhookEventService.reserveEvent")) {
  violations.push("Stripe webhook must reserve events before business processing.");
}

if (routes && !routes.includes("stripeWebhookEventService.markProcessed")) {
  violations.push("Stripe webhook must mark successful events as processed.");
}

if (routes && !routes.includes("stripeWebhookEventService.markFailed")) {
  violations.push("Stripe webhook must mark failed events for retry.");
}

// Business processing validation
if (routes && !routes.includes("stripeEventProcessor.processStripeEvent(event)")) {
  violations.push("Stripe webhook must pass verified events to stripeEventProcessor.");
}

// Payment contract validation (still applicable)
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
