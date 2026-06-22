const express = require("express");
const router = express.Router();
const cronMonitor = require("../services/cronMonitor.service");
const ApiResponse = require("../utils/apiResponse");
const { requireAdmin } = require("../middleware/auth");

const systemHealthService = require("../services/systemHealth.service");

// GET /api/system/cron-health
router.get("/cron-health", requireAdmin, async (req, res, next) => {
  try {
    const health = await cronMonitor.getCronHealth();
    res.json(ApiResponse.success("CRON_HEALTH_OK", { jobs: health }));
  } catch (error) {
    next(error);
  }
});

// GET /api/system/health
router.get("/health", requireAdmin, async (req, res, next) => {
  try {
    const healthData = await systemHealthService.calculateSystemHealthScore();
    res.json(ApiResponse.success("SYSTEM_HEALTH_OK", healthData));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
