const express = require("express");
const router = express.Router();

const metricsAggregationJob = require("../jobs/metricsAggregationJob");
const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");

router.get(
  "/funnel",
  auth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const days = parseInt(req.query.days, 10) || 30;
      const metrics = await metricsAggregationJob.calculateMetrics(days);

      res.json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;