const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const CacheService = require("../services/cache.service");

router.post("/cache/invalidate", auth, requireAdmin, (req, res) => {
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
