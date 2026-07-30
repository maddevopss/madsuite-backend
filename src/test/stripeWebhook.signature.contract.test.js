const fs = require("fs");
const path = require("path");

const appPath = path.resolve(__dirname, "../app.js");
const routePath = path.resolve(__dirname, "../routes/stripe.routes.js");

const appSource = fs.readFileSync(appPath, "utf8");
const routeSource = fs.readFileSync(routePath, "utf8");

describe("Webhook Stripe — contrat de validation cryptographique P0", () => {
  // Contrat 1 — webhook brut avant JSON
  test("webhook brut avant express.json()", () => {
    const webhookIndex = appSource.indexOf('"/api/stripe/webhook"');
    const rawIndex = appSource.indexOf(
      'express.raw({ type: "application/json" })',
    );
    const jsonIndex = appSource.indexOf("app.use(express.json())");

    expect(webhookIndex).toBeGreaterThanOrEqual(0);
    expect(rawIndex).toBeGreaterThan(webhookIndex);
    expect(jsonIndex).toBeGreaterThan(rawIndex);
  });

  // Contrat 2 — routes Stripe JSON après JSON parser
  test("routes Stripe ordinaires après express.json()", () => {
    const jsonIndex = appSource.indexOf("app.use(express.json())");
    const stripeRouterIndex = appSource.indexOf(
      'app.use("/api/stripe", stripeRoutes.router)',
    );

    expect(jsonIndex).toBeGreaterThanOrEqual(0);
    expect(stripeRouterIndex).toBeGreaterThan(jsonIndex);
  });

  // Contrat 3 — signature Stripe vérifiée
  test("signature Stripe vérifiée avec le secret webhook", () => {
    expect(routeSource).toContain(
      'req.headers["stripe-signature"]',
    );
    expect(routeSource).toContain(
      "process.env.STRIPE_WEBHOOK_SECRET",
    );
    expect(routeSource).toContain(
      "stripe.webhooks.constructEvent(req.body, sig, webhookSecret)",
    );
  });

  // Contrat 4 — signature invalide refusée avant traitement métier
  test("signature invalide refusée avant traitement métier", () => {
    const constructIndex = routeSource.indexOf(
      "stripe.webhooks.constructEvent(req.body, sig, webhookSecret)",
    );

    const invalidSignatureIndex = routeSource.indexOf(
      'error: "Invalid Stripe webhook signature"',
    );

    const processorIndex = routeSource.indexOf(
      "stripeEventProcessor.processStripeEvent(event)",
    );

    expect(constructIndex).toBeGreaterThanOrEqual(0);
    expect(invalidSignatureIndex).toBeGreaterThan(constructIndex);
    expect(processorIndex).toBeGreaterThan(invalidSignatureIndex);
  });

  // Contrat 5 — aucun traitement sans secret
  test("aucun traitement sans secret webhook", () => {
    const secretGuardIndex = routeSource.indexOf(
      "if (!webhookSecret)",
    );

    const unavailableIndex = routeSource.indexOf(
      "res.status(503)",
    );

    const constructIndex = routeSource.indexOf(
      "stripe.webhooks.constructEvent",
    );

    expect(secretGuardIndex).toBeGreaterThanOrEqual(0);
    expect(unavailableIndex).toBeGreaterThan(secretGuardIndex);
    expect(constructIndex).toBeGreaterThan(unavailableIndex);
  });

  // Contrat 6 — aucun montage webhook en double
  test("aucun montage webhook en double", () => {
    expect(appSource).toContain('"/api/stripe/webhook"');
    expect(routeSource).not.toContain('router.post(\n  "/webhook"');
  });
});
