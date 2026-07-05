const express = require("express");
const router = express.Router();

const metricsAggregationJob = require("../jobs/metricsAggregationJob");
const auth = require("../middleware/auth");
const requireSuperAdmin = require("../middleware/requireSuperAdmin");
const analyticsService = require("../services/analytics.service");
const { getOrganisationId } = require("../utils/organisationScope");
const db = require("../../db");

const MAX_METADATA_BYTES = 4096;
const MAX_METADATA_DEPTH = 3;
const MAX_METADATA_KEYS = 25;

function sanitizeAnalyticsMetadata(value, depth = 0) {
  if (depth > MAX_METADATA_DEPTH) return null;
  if (value === null || value === undefined) return null;

  if (["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "string") return value.slice(0, 500);
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeAnalyticsMetadata(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_METADATA_KEYS)
        .filter(([key]) => typeof key === "string" && key.length <= 80)
        .map(([key, item]) => [key, sanitizeAnalyticsMetadata(item, depth + 1)]),
    );
  }

  return null;
}

function validateAndSanitizeMetadata(metadata) {
  const safeMetadata = sanitizeAnalyticsMetadata(metadata || {});
  const serialized = JSON.stringify(safeMetadata || {});

  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    const err = new Error("metadata trop volumineux");
    err.statusCode = 400;
    throw err;
  }

  return safeMetadata || {};
}

router.get(
  "/funnel",
  auth,
  requireSuperAdmin,
  async (req, res, next) => {
    try {
      const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
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
  "checkout_clicked_from_invoice",
]);

// Generic track endpoint (for non-critical frontend events only).
// Critical funnel events (signup_completed, first_*, checkout_started for subs/modules, subscription_active) are tracked server-side.
router.post("/track", auth, async (req, res, next) => {
  try {
    const { event_name } = req.body;
    const metadata = validateAndSanitizeMetadata(req.body.metadata || {});
    const organisationId = getOrganisationId(req);
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
    if (e.statusCode === 400) {
      return res.status(400).json({ success: false, error: e.message });
    }

    // non blocking for tracking
    return res.json({ success: true });
  }
});

module.exports = router;
