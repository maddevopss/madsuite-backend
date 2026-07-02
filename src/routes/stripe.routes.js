const express = require("express");
const router = express.Router();
const stripeService = require("../services/stripe.service");
const auth = require("../middleware/auth");
const analyticsService = require("../services/analytics.service");

// Nécessaire pour Stripe Webhooks (doit parser le raw body)
// Ce middleware spécifique est généralement configuré au niveau de app.js, 
// mais nous gérons la route ici. Assurez-vous que express.raw est utilisé
// pour cette route avant express.json.
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!webhookSecret) {
  throw new Error("STRIPE_WEBHOOK_SECRET must be set");
}
    let event;

    try {
      event = stripeService.stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed.", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      await stripeService.handleWebhook(event);
      res.json({ received: true });
    } catch (err) {
      console.error("Error handling webhook:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// Route pour créer une session d'abonnement (réservé aux admins de l'organisation)
router.post("/create-checkout-session", auth, async (req, res, next) => {
  try {
    const { successUrl, cancelUrl } = req.body;
    
    // Seulement l'admin de l'org peut souscrire
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Non autorisé" });
    }

    // Backend-only tracking for checkout_started (idempotent at analytics level if needed)
    try {
      await analyticsService.trackEvent("checkout_started", {
        organisationId: req.user.organisation_id,
        userId: req.user.id,
        metadata: { type: "subscription" }
      });
    } catch (e) { /* non-blocking */ }

    const sessionUrl = await stripeService.createSubscriptionCheckoutSession(
      req.user.organisation_id,
      req.user.email,
      successUrl,
      cancelUrl
    );

    res.json({ success: true, url: sessionUrl });
  } catch (err) {
    console.error("Erreur create-checkout-session:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/connect", auth, async (req, res) => {
  try {
    const { returnUrl, refreshUrl } = req.body;
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Non autorisé" });
    }

    const accountLinkUrl = await stripeService.createAccountLink(
      req.user.organisation_id,
      returnUrl,
      refreshUrl
    );

    res.json({ success: true, url: accountLinkUrl });
  } catch (err) {
    console.error("Erreur stripe/connect:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/reconcile", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Non autorisé" });
    }

    const reconciliationService = require("../services/stripe-reconciliation.service");
    const result = await reconciliationService.runFullReconciliation(req.user.organisation_id);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Erreur stripe/reconcile:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
