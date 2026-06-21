const express = require("express");
const db = require("../../db");
const requireRole = require("../middleware/requireRole");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");
const logger = require("../config/logger");

const { idParamSchema } = require("../validators/common.validator");
const {
  activityRuleSchema,
  updateActivityRuleSchema,
  classifyContextSchema,
  feedbackSchema,
} = require("../validators/activityIntelligence.validator");

const activityIntelligenceService = require("../services/activityIntelligence.service");
const aiService = require("../services/ai.service");

const router = express.Router();

router.use(requireOrganisation);
router.use(requireRole("admin"));

function emptyOnMissingActivityTables(err, res, next) {
  if (activityIntelligenceService.missingActivityTables(err)) {
    return res.status(200).json(ApiResponse.success("ACTIVITY_INTELLIGENCE_EMPTY", []));
  }
  return next(err);
}

router.get("/insights", async (req, res, next) => {
  try {
    const insights = await activityIntelligenceService.getInsights({
      db: db.pool,
      userId: req.user.id,
      role: req.user?.role,
    });
    return res.status(200).json(ApiResponse.success("ACTIVITY_INTELLIGENCE_INSIGHTS_LISTED", insights));
  } catch (err) {
    return emptyOnMissingActivityTables(err, res, next);
  }
});

router.post("/analyze", async (req, res, next) => {
  try {
    const { activityLogId } = req.body;
    if (!activityLogId) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "activityLogId requis." }));
    }

    const result = await activityIntelligenceService.analyzeActivityLog({
      db: db.pool,
      organisationId: activityIntelligenceService.getOrganisationId(req),
      activityLogId,
      userId: req.user.id,
      role: req.user?.role,
    });

    return res.status(200).json(ApiResponse.success("ACTIVITY_LOG_ANALYZED", result));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/auto-timesheet", async (req, res, next) => {
  try {
    const { targetDate } = req.body;
    if (!targetDate) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "targetDate requis." }));
    }

    const suggestions = await aiService.generateTimesheetSuggestions({
      organisationId: activityIntelligenceService.getOrganisationId(req),
      userId: req.user.id,
      targetDate
    });

    return res.status(200).json(ApiResponse.success("AUTO_TIMESHEET_GENERATED", suggestions));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/ai-categorize-unclassified", async (req, res, next) => {
  try {
    const organisationId = activityIntelligenceService.getOrganisationId(req);
    
    // Fetch unclassified activities (max 30)
    const result = await db.query(
      `SELECT id, app_name, window_title 
       FROM activity_logs 
       WHERE (organisation_id = $1 OR organisation_id IS NULL) 
         AND (activity_category IS NULL OR activity_category = 'Non classé' OR activity_category = 'Autre')
         AND window_title IS NOT NULL
       ORDER BY captured_at DESC LIMIT 30`,
      [organisationId]
    );
    
    const activities = result.rows;
    if (activities.length === 0) {
      return res.status(200).json(ApiResponse.success("NO_UNCLASSIFIED_ACTIVITIES", { message: "Aucune activité à classer." }));
    }

    const categorized = await aiService.categorizeActivitiesBatch({
      activities,
      organisationId
    });

    return res.status(200).json(ApiResponse.success("ACTIVITIES_CATEGORIZED", { categorized }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

async function classifyContext(req, res, next) {
  try {
    const parsed = classifyContextSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(
        ApiResponse.error("VALIDATION_ERROR", {
          message: "Données invalides",
          errors: parsed.error.flatten(),
        }),
      );
    }

    const classification = await activityIntelligenceService.classifyCurrentContext({
      db: db.pool,
      organisationId: activityIntelligenceService.getOrganisationId(req),
      currentActivity: parsed.data.currentActivity,
      openWindows: parsed.data.openWindows,
    });

    return res.status(200).json(ApiResponse.success("CONTEXT_CLASSIFIED", classification));
  } catch (err) {
    next(err);
  }
}

router.post("/classify-context", classifyContext);
router.post("/classify", classifyContext);

router.get("/rules", async (req, res, next) => {
  try {
    const rules = await activityIntelligenceService.listRules({
      db: db.pool,
      organisationId: activityIntelligenceService.getOrganisationId(req),
    });
    return res.status(200).json(ApiResponse.success("RULES_LISTED", rules));
  } catch (err) {
    return emptyOnMissingActivityTables(err, res, next);
  }
});

router.post("/rules", requireRole("admin"), async (req, res, next) => {
  try {
    const parsed = activityRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(
        ApiResponse.error("VALIDATION_ERROR", {
          message: "Données invalides",
          errors: parsed.error.flatten(),
        }),
      );
    }

    const rule = await activityIntelligenceService.createRule({
      db: db.pool,
      organisationId: activityIntelligenceService.getOrganisationId(req),
      userId: req.user.id,
      data: parsed.data,
    });

    return res.status(201).json(ApiResponse.success("RULE_CREATED", rule));
  } catch (err) {
    next(err);
  }
});

router.put("/rules/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const params = idParamSchema.safeParse(req.params);
    const parsed = updateActivityRuleSchema.safeParse(req.body);

    if (!params.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }
    if (!parsed.success) {
      return res.status(400).json(
        ApiResponse.error("VALIDATION_ERROR", {
          message: "Données invalides",
          errors: parsed.error.flatten(),
        }),
      );
    }

    const rule = await activityIntelligenceService.updateRule({
      db: db.pool,
      ruleId: params.data.id,
      organisationId: activityIntelligenceService.getOrganisationId(req),
      data: parsed.data,
    });

    if (!rule) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Règle introuvable." }));
    }

    return res.status(200).json(ApiResponse.success("RULE_UPDATED", rule));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.delete("/rules/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }

    const deleted = await activityIntelligenceService.disableRule({
      db: db.pool,
      ruleId: params.data.id,
      organisationId: activityIntelligenceService.getOrganisationId(req),
    });

    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Règle introuvable." }));
    }

    return res.status(200).json(ApiResponse.success("RULE_DISABLED"));
  } catch (err) {
    next(err);
  }
});

router.post("/feedback", async (req, res, next) => {
  try {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(
        ApiResponse.error("VALIDATION_ERROR", {
          message: "Données invalides",
          errors: parsed.error.flatten(),
        }),
      );
    }

    const feedback = await activityIntelligenceService.saveActivityFeedback({
      db: db.pool,
      organisationId: activityIntelligenceService.getOrganisationId(req),
      userId: req.user.id,
      data: parsed.data,
    });

    return res.status(201).json(ApiResponse.success("FEEDBACK_RECORDED", feedback));
  } catch (err) {
    next(err);
  }
});

router.post("/brain-dump", async (req, res, next) => {
  const requestId = req.id;
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "Prompt est requis" }));
  }

  logger.info(`[${requestId}] Brain Dump process start`, { userId: req.user.id });

  try {
    const tasks = await aiService.generateBrainDumpTasks({ prompt });
    logger.info(`[${requestId}] Brain Dump process complete`, { tasksCount: tasks.length });

    return res.status(200).json({ success: true, tasks });
  } catch (err) {
    logger.error(`[${requestId}] Brain Dump process failed`, {
      error: err.message,
    });
    // Return graceful fallback if AI fails or disabled
    return res.status(200).json({ 
      success: true, 
      tasks: [ { title: prompt.slice(0, 30) + "...", duration_minutes: 25 } ] 
    });
  }
});

module.exports = router;
