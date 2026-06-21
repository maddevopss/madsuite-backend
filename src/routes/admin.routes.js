const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../middleware/auth");
const CacheService = require("../services/cache.service");

router.post("/cache/invalidate", requireAdmin, (req, res) => {
  const { pattern } = req.body;

  if (!pattern) {
    return res.status(400).json({ error: "pattern required" });
  }

  CacheService.invalidate(pattern);

  res.json({
    success: true,
    message: `Cache entries matching '${pattern}' invalidated`,
  });
});
