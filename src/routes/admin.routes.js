const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const CacheService = require("../services/cache.service");

router.post("/cache/invalidate", auth, requireAdmin, (req, res) => {
  const { pattern } = req.body;
  const organisationId = req.user?.organisation_id;

  if (!pattern) {
    return res.status(400).json({ error: "pattern required" });
  }

  if (!organisationId) {
    return res.status(403).json({ error: "organisation context required" });
  }

  // Invalidate only cache entries for this organisation
  CacheService.invalidate(pattern, organisationId);

  res.json({
    success: true,
    message: `Cache entries matching '${pattern}' invalidated for organisation ${organisationId}`,
  });
});

const { runBugfixAgent } = require("../agents/bugfix.runner");

router.post("/agent/bugfix", auth, requireAdmin, async (req, res) => {
  try {
    const { description, context } = req.body || {};

    if (!description || typeof description !== "string") {
      return res.status(400).json({ error: "description required" });
    }

    const result = await runBugfixAgent({
      description,
      context: typeof context === "string" ? context : "",
    });

    return res.json({
      rootCause: result.rootCause,
      fix: result.fix,
      riskLevel: result.riskLevel,
      affectedFiles: result.affectedFiles,
    });
  } catch (err) {
    return res.status(500).json({
      error: "BUGFIX_AGENT_FAILED",
      message: err?.message || String(err),
    });
  }
});
