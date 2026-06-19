const express = require("express");
const { z } = require("zod");

const logger = require("../config/logger");
const requireRole = require("../middleware/requireRole");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const ApiResponse = require("../utils/apiResponse");
const projectDetectionService = require("../services/projectDetection.service");

const router = express.Router();

router.use(requireOrganisation);
router.use(requireRole("admin"));

const suggestSchema = z.object({
  appName: z.string().trim().max(255).optional().default(""),
  windowTitle: z.string().trim().max(1000).optional().default(""),
});

const patternSchema = z.object({
  projet_id: z.coerce.number().int().positive(),
  keyword: z.string().trim().min(2).max(255),
  weight: z.coerce.number().min(0).max(10).optional().default(1),
});

const feedbackSchema = z.object({
  activityLogId: z.coerce.number().int().positive().optional().nullable(),
  projet_id: z.coerce.number().int().positive().optional().nullable(),
  appName: z.string().trim().max(255).optional().default(""),
  windowTitle: z.string().trim().max(1000).optional().default(""),
  feedback_type: z.enum(["confirmed", "rejected", "corrected"]),
});

function handleProjectDetectionError(err, res) {
  if (err.code === "42P01" || err.code === "42703") {
    return res.status(501).json(ApiResponse.error("NOT_IMPLEMENTED", {
      message: "La détection projet n'est pas encore complètement installée.",
    }));
  }

  logger.warn("projectDetection error", { error: err.message });
  return res.status(500).json(ApiResponse.error("INTERNAL_ERROR", {
    message: "Erreur détection projet.",
  }));
}

router.post("/suggest", async (req, res) => {
  try {
    const parsed = suggestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Données invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const result = await projectDetectionService.suggestProject({
      appName: parsed.data.appName,
      windowTitle: parsed.data.windowTitle,
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json(ApiResponse.success("PROJECT_SUGGESTED", result));
  } catch (err) {
    logger.warn("projectDetection /suggest fallback", { error: err.message });
    return res.status(200).json(ApiResponse.success("PROJECT_SUGGESTION_UNAVAILABLE", {
      suggestion: null,
      suggestions: [],
      warning: "Détection projet indisponible pour le moment.",
    }));
  }
});

router.post("/patterns", async (req, res) => {
  try {
    const parsed = patternSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Données invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const pattern = await projectDetectionService.createPattern({
      projetId: parsed.data.projet_id,
      keyword: parsed.data.keyword,
      weight: parsed.data.weight,
      organisationId: getOrganisationId(req),
    });

    return res.status(201).json(ApiResponse.success("PROJECT_PATTERN_CREATED", pattern));
  } catch (err) {
    return handleProjectDetectionError(err, res);
  }
});

router.post("/feedback", async (req, res) => {
  try {
    const parsed = feedbackSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Données invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const feedback = await projectDetectionService.saveFeedback({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      activityLogId: parsed.data.activityLogId || null,
      projetId: parsed.data.projet_id || null,
      appName: parsed.data.appName,
      windowTitle: parsed.data.windowTitle,
      feedbackType: parsed.data.feedback_type,
    });

    return res.status(201).json(ApiResponse.success("PROJECT_FEEDBACK_RECORDED", feedback));
  } catch (err) {
    return handleProjectDetectionError(err, res);
  }
});

module.exports = router;
