const express = require("express");
const router = express.Router();
const cronMonitor = require("../services/cronMonitor.service");
const ApiResponse = require("../utils/apiResponse");
const auth = require("../middleware/auth");
// FIX P1 (audit multi-tenant 2026-06-24) :
// system_consistency_logs ne contient pas d'organisation_id — les données
// de monitoring global (invoice_id cross-tenant, anomalies ledger) ne doivent
// être accessibles qu'aux super-admins plateforme, pas aux admins d'organisation.
const requireSuperAdmin = require("../middleware/requireSuperAdmin");

const systemHealthService = require("../services/systemHealth.service");

// GET /api/system/cron-health
// Restreint aux super-admins plateforme (données de monitoring global)
router.get("/cron-health", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const health = await cronMonitor.getCronHealth();
    res.json(ApiResponse.success("CRON_HEALTH_OK", { jobs: health }));
  } catch (error) {
    next(error);
  }
});

// GET /api/system/health
// Restreint aux super-admins plateforme (données de cohérence globale cross-tenant)
router.get("/health", auth, requireSuperAdmin, async (req, res, next) => {
  try {
    const healthData = await systemHealthService.calculateSystemHealthScore();
    res.json(ApiResponse.success("SYSTEM_HEALTH_OK", healthData));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
