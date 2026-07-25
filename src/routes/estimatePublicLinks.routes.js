const express = require("express");
const { z } = require("zod");

const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");
const publicLinkService = require("../services/estimate/estimate-public-link.service");

const router = express.Router();
router.use(requireOrganisation);

const idSchema = z.coerce.number().int().positive();
const createLinkSchema = z.object({
  expires_in_days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

function requireAdmin(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json(ApiResponse.error("FORBIDDEN", { message: "Permissions insuffisantes" }));
    return false;
  }
  return true;
}

router.post("/:estimateId", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const estimateId = idSchema.parse(req.params.estimateId);
    const payload = createLinkSchema.parse(req.body || {});
    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
    const result = await publicLinkService.createEstimatePublicLink({
      estimateId,
      organisationId: getOrganisationId(req),
      createdBy: req.user?.id || null,
      baseUrl,
      expiresInDays: payload.expires_in_days,
      req,
    });
    if (!result) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Soumission introuvable." }));
    }
    return res.status(201).json(ApiResponse.success("ESTIMATE_PUBLIC_LINK_CREATED", result));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Données invalides",
        errors: error.flatten(),
      }));
    }
    return handleServiceError(error, res, next);
  }
});

router.get("/:estimateId/status", async (req, res, next) => {
  try {
    const estimateId = idSchema.parse(req.params.estimateId);
    const result = await publicLinkService.getEstimatePublicLinkStatus({
      estimateId,
      organisationId: getOrganisationId(req),
    });
    return res.status(200).json(ApiResponse.success("ESTIMATE_PUBLIC_LINK_STATUS", result));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }
    return handleServiceError(error, res, next);
  }
});

router.delete("/:estimateId", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const estimateId = idSchema.parse(req.params.estimateId);
    const result = await publicLinkService.revokeEstimatePublicLink({
      estimateId,
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id || null,
      req,
    });
    return res.status(200).json(ApiResponse.success("ESTIMATE_PUBLIC_LINK_REVOKED", result));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }
    return handleServiceError(error, res, next);
  }
});

module.exports = router;