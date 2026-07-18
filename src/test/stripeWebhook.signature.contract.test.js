const fs = require("fs");
const path = require("path");

const routePath = path.resolve(__dirname, "../routes/stripe.routes.js");
const source = fs.readFileSync(routePath, "utf8");

describe("Webhook Stripe — contrat de validation cryptographique P0", () => {
  test("le corps brut est conservé avant la construction de l'événement", () => {
    const rawIndex = source.indexOf('express.raw({ type: "application/json" })');
    const constructIndex = source.indexOf("stripe.webhooks.constructEvent");

    expect(rawIndex).toBeGreaterThanOrEqual(0);
    expect(constructIndex).toBeGreaterThan(rawIndex);
  });

  test("la signature Stripe est lue et vérifiée avec le secret webhook", () => {
    expect(source).toContain('req.headers["stripe-signature"]');
    expect(source).toContain("process.env.STRIPE_WEBHOOK_SECRET");
    expect(source).toContain("constructEvent(req.body, sig, webhookSecret)");
  });

  test("une signature invalide retourne 400 avant tout traitement métier", () => {
    const constructIndex = source.indexOf("constructEvent(req.body, sig, webhookSecret)");
    const badRequestIndex = source.indexOf("res.status(400)");
    const handlerIndex = source.indexOf("stripeService.handleWebhook(event)");

    expect(constructIndex).toBeGreaterThanOrEqual(0);
    expect(badRequestIndex).toBeGreaterThan(constructIndex);
    expect(handlerIndex).toBeGreaterThan(badRequestIndex);
  });

  test("aucun fallback ne permet de traiter le payload sans secret webhook", () => {
    expect(source).toContain('throw new Error("STRIPE_WEBHOOK_SECRET must be set")');
  });
});
