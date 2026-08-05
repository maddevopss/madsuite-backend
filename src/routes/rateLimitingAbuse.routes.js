const express = require("express");
const db = require("../../db");
const rateLimitingAbuseService = require("../services/rateLimitingAbuseService");

const router = express.Router();

// Les tables stage6 rate-limiting referencent organizations(id) par FK. Les appelants
// (E2E, clients externes) ne passent que l'id — on upsert un placeholder minimal pour
// eviter un 500 sur FK violation, memes conventions que les fixtures de test existantes.
async function ensureOrganization(organizationId) {
  if (!organizationId) return;
  await db.pool.query(
    `INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [organizationId, "Auto-provisioned organization"]
  );
}

router.use(async (req, res, next) => {
  try {
    const organizationId = req.body?.organizationId || req.query?.organizationId;
    await ensureOrganization(organizationId);
    next();
  } catch (error) {
    next(error);
  }
});

router.post("/rate-limit-policies", async (req, res, next) => {
  try {
    const { organizationId, policyName, policyConfig } = req.body || {};
    const result = await rateLimitingAbuseService.createRateLimitPolicy(organizationId, policyName, policyConfig);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/rate-limit/check", async (req, res, next) => {
  try {
    const { policyId, userId, apiKeyId, ipAddress, organizationId } = req.body || {};
    const result = await rateLimitingAbuseService.checkRateLimit(policyId, userId, apiKeyId, ipAddress, organizationId);

    if (result.allowed === false && result.reason === "rate_limit_exceeded") {
      res.set("Retry-After", String(result.retry_after_seconds ?? 60));
      return res.status(429).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/abuse-alerts", async (req, res, next) => {
  try {
    const { organizationId, alertType, alertConfig } = req.body || {};
    const result = await rateLimitingAbuseService.recordAbuseAlert(organizationId, alertType, alertConfig);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/block-entity", async (req, res, next) => {
  try {
    const { alertId, organizationId, blockReason, blockDurationMinutes } = req.body || {};
    const result = await rateLimitingAbuseService.blockEntity(alertId, organizationId, blockReason, blockDurationMinutes);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/ip-access-control", async (req, res, next) => {
  try {
    const { organizationId, ipAddress, listType, controlConfig } = req.body || {};
    const result = await rateLimitingAbuseService.addIpAccessControl(organizationId, ipAddress, listType, controlConfig);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/traffic-anomalies", async (req, res, next) => {
  try {
    const { organizationId, anomalyConfig } = req.body || {};
    const result = await rateLimitingAbuseService.detectTrafficAnomaly(organizationId, anomalyConfig);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/bot-detection", async (req, res, next) => {
  try {
    const { organizationId, botConfig } = req.body || {};
    const result = await rateLimitingAbuseService.recordBotDetection(organizationId, botConfig);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/queue-request", async (req, res, next) => {
  try {
    const { organizationId, userId, apiKeyId, ipAddress, requestConfig } = req.body || {};
    const result = await rateLimitingAbuseService.queueRequest(organizationId, userId, apiKeyId, ipAddress, requestConfig);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/rate-limit-summary", async (req, res, next) => {
  try {
    const result = await rateLimitingAbuseService.getRateLimitSummary(req.query.organizationId || null);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/abuse-detection-summary", async (req, res, next) => {
  try {
    const result = await rateLimitingAbuseService.getAbuseDetectionSummary(req.query.organizationId || null);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/traffic-anomaly-summary", async (req, res, next) => {
  try {
    const result = await rateLimitingAbuseService.getTrafficAnomalySummary(req.query.organizationId || null);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
