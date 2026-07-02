const express = require("express");
const router = express.Router();

const metricsAggregationJob = require("../jobs/metricsAggregationJob");
const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
const analyticsService = require("../services/analytics.service");
const db = require("../../db");

router.get(
  "/funnel",
  auth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const days = parseInt(req.query.days, 10) || 30;
      const metrics = await metricsAggregationJob.calculateMetrics(days);

      // Quick Revenue Truth snapshot (for before/after verification)
      // Compare:
      // - analytics_events counts (X)
      // - DB state (Y)
      // Full Stripe Z available via manual reconcile or future daily job extension.
      // In production, the daily systemReconciliationJob produces detailed REVENUE_*_TRUTH_DRIFT anomalies.
      let revenueTruth = null;
      try {
        const truthRes = await db.query(`
          SELECT 
            (SELECT COUNT(DISTINCT organisation_id) FROM analytics_events WHERE event_name = 'subscription_active' AND created_at >= NOW() - INTERVAL '90 days') as analytics_subscription_active,
            (SELECT COUNT(*) FROM organisations WHERE plan_type = 'pro' OR subscription_status = 'active') as db_pro_orgs,
            (SELECT COUNT(DISTINCT organisation_id) FROM analytics_events WHERE event_name IN ('first_invoice_created', 'invoice_created') AND created_at >= NOW() - INTERVAL '90 days') as analytics_first_invoices,
            (SELECT COUNT(DISTINCT organisation_id) FROM invoices) as db_orgs_with_invoices
        `);
        revenueTruth = truthRes.rows[0];
      } catch (e) {
        revenueTruth = { error: 'truth query failed' };
      }

      res.json({
        success: true,
        data: {
          ...metrics,
          revenue_truth_snapshot: revenueTruth
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// P1-6 fix: Whitelist stricte des événements frontend autorisés.
// Les événements critiques (signup_completed, subscription_active, etc.) sont trackés côté serveur uniquement.
const ALLOWED_FRONTEND_EVENTS = new Set([
  "page_view",
  "button_click",
  "feature_used",
  "onboarding_step_viewed",
  "dashboard_viewed",
  "invoice_viewed",
  "estimate_viewed",
  "report_viewed",
  "timer_started_ui",
  "timer_stopped_ui",
  "client_form_opened",
  "project_form_opened",
  "ai_copilot_opened",
  "settings_viewed",
  "billing_viewed",
]);

// Generic track endpoint (for non-critical frontend events only).
// Critical funnel events (signup_completed, first_*, checkout_started for subs/modules, subscription_active) are tracked server-side.
router.post("/track", auth, async (req, res) => {
  try {
    const { event_name, metadata = {} } = req.body;
    const organisationId = req.user?.organisation_id;
    const userId = req.user?.id;

    if (!event_name || !organisationId) {
      return res.status(400).json({ success: false, error: "Paramètres manquants." });
    }

    // P1-6 fix: Valider que l'event_name est dans la whitelist autorisée
    if (!ALLOWED_FRONTEND_EVENTS.has(event_name)) {
      return res.status(400).json({ success: false, error: "Événement non autorisé." });
    }

    await analyticsService.trackEvent(event_name, {
      organisationId,
      userId,
      metadata
    });

    res.json({ success: true });
  } catch (e) {
    // non blocking for tracking
    res.json({ success: true });
  }
});

module.exports = router;