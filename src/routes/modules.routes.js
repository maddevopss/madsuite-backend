const express = require("express");
const router = express.Router();
const db = require("../../db");
const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { MODULES, isModuleIncludedInPlan, getModuleRegistryDiagnostics } = require("../config/modules");
const ApiResponse = require("../utils/apiResponse");
const analyticsService = require("../services/analytics.service");

function currentOrganisationId(req) {
  return req.organisationId || req.user?.organisation_id;
}

/**
 * Toutes les routes de modules utilisent l'organisation courante.
 * On force donc le contexte organisationnel explicitement avant les handlers.
 */
router.use(auth);
router.use(requireOrganisation);

/**
 * GET /api/organisation/modules
 * Liste tous les modules avec leur statut (actif/inactif) pour l'organisation courante.
 * Accessible par tous les utilisateurs authentifiés.
 */
router.get("/", async (req, res) => {
  try {
    const organisationId = currentOrganisationId(req);

    // Retrieve organisation plan
    const orgResult = await db.query(
      "SELECT plan_type FROM organisations WHERE id = $1",
      [organisationId]
    );
    const planType = orgResult.rows[0]?.plan_type || "free";

    // Retrieve explicitly enabled modules
    const enabledResult = await db.query(
      "SELECT module_key, is_active FROM organisation_modules WHERE organisation_id = $1",
      [organisationId]
    );
    const enabledMap = {};
    enabledResult.rows.forEach(row => {
      enabledMap[row.module_key] = row.is_active;
    });

    // Retrieve dynamic pricing for all modules
    const pricingResult = await db.query(
      "SELECT module_key, price_cents, currency FROM module_pricing"
    );
    const pricingMap = {};
    pricingResult.rows.forEach(row => {
      pricingMap[row.module_key] = {
        price_cents: row.price_cents,
        currency: row.currency
      };
    });

    // Build the full response
    const modules = Object.entries(MODULES).map(([key, config]) => {
      const includedInPlan = isModuleIncludedInPlan(key, planType);
      const explicitlyEnabled = enabledMap[key] === true;
      const isActive = includedInPlan || explicitlyEnabled;

      // Override static price with dynamic pricing if present
      const dynamic = pricingMap[key];
      const price = dynamic ? dynamic.price_cents / 100 : config.price; // convert to dollars

      return {
        key,
        label: config.label,
        plan: config.plan,
        price,
        currency: dynamic ? dynamic.currency : "CAD",
        matrix_status: config.matrix_status,
        is_active: isActive,
        active: isActive,
        included_in_plan: includedInPlan,
        included: includedInPlan,
        is_addon_active: !includedInPlan && explicitlyEnabled,
      };
    });

    return res.status(200).json(ApiResponse.success("MODULES_LISTED", {
      plan_type: planType,
      modules,
      diagnostics: getModuleRegistryDiagnostics(),
    }));
  } catch (err) {
    console.error("Erreur modules list:", err);
    res.status(500).json(ApiResponse.error("SERVER_ERROR", { message: "Erreur serveur" }));
  }
});

/**
 * POST /api/organisation/modules/:key
 * Active un module pour l'organisation. Admin only.
 */
router.post("/:key", requireRole("admin"), async (req, res) => {
  try {
    const { key } = req.params;
    const organisationId = currentOrganisationId(req);

    if (!MODULES[key]) {
      return res.status(400).json(ApiResponse.error("INVALID_MODULE", { message: `Module "${key}" inconnu.` }));
    }

    await db.query(
      `INSERT INTO organisation_modules (organisation_id, module_key, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (organisation_id, module_key) 
       DO UPDATE SET is_active = true, activated_at = CURRENT_TIMESTAMP`,
      [organisationId, key]
    );

    return res.status(200).json(ApiResponse.success("MODULE_ACTIVATED", { module_key: key }));
  } catch (err) {
    console.error("Erreur module activate:", err);
    res.status(500).json(ApiResponse.error("SERVER_ERROR", { message: "Erreur serveur" }));
  }
});

/**
 * DELETE /api/organisation/modules/:key
 * Désactive un module pour l'organisation. Admin only.
 * Les données restent en lecture seule.
 */
router.delete("/:key", requireRole("admin"), async (req, res) => {
  try {
    const { key } = req.params;
    const organisationId = currentOrganisationId(req);

    if (!MODULES[key]) {
      return res.status(400).json(ApiResponse.error("INVALID_MODULE", { message: `Module "${key}" inconnu.` }));
    }

    await db.query(
      `UPDATE organisation_modules SET is_active = false WHERE organisation_id = $1 AND module_key = $2`,
      [organisationId, key]
    );

    return res.status(200).json(ApiResponse.success("MODULE_DEACTIVATED", { module_key: key }));
  } catch (err) {
    console.error("Erreur module deactivate:", err);
    res.status(500).json(ApiResponse.error("SERVER_ERROR", { message: "Erreur serveur" }));
  }
});

/**
 * POST /api/organisation/modules/:key/checkout
 * Crée une Stripe Checkout Session pour l'add‑on demandé.
 * Admin only.
 */
router.post('/:key/checkout', requireRole('admin'), async (req, res) => {
  try {
    const { key } = req.params;
    const organisationId = currentOrganisationId(req);

    if (!MODULES[key] || MODULES[key].plan !== 'addon') {
      return res.status(400).json(ApiResponse.error('INVALID_MODULE', { message: `Module "${key}" ne peut pas être acheté.` }));
    }

    // Backend-only tracking for checkout_started (funnel critical)
    try {
      await analyticsService.trackEvent("checkout_started", {
        organisationId,
        userId: req.user.id,
        metadata: { type: "module", module_key: key }
      });
    } catch (e) { /* non-blocking */ }

    // Charger le service Stripe checkout
    const { createCheckoutSession } = require('../services/stripeCheckout.service');
    const session = await createCheckoutSession(organisationId, key);
    return res.status(200).json(ApiResponse.success('CHECKOUT_SESSION_CREATED', { checkoutSessionId: session.id }));
  } catch (err) {
    console.error('Erreur checkout module:', err);
    res.status(500).json(ApiResponse.error('SERVER_ERROR', { message: 'Erreur serveur' }));
  }
});

module.exports = router;
