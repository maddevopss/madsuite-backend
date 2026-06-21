const express = require("express");

const {
  createActivitySchema,
  createWindowLogsSchema,
  updateActivityDurationSchema,
  batchEventsSchema,
} = require("../validators/activity.validator");
const { idParamSchema } = require("../validators/common.validator");
const { getOrganisationId } = require("../utils/organisationScope");
const activityService = require("../services/activity.service");
const timerService = require("../services/timer.service");
const ApiResponse = require("../utils/apiResponse");
const logger = require("../config/logger");

const router = express.Router();

router.delete("/history", async (req, res, next) => {
  const requestId = req.id;

  try {
    logger.info(`[${requestId}] Delete activity history start`, {
      userId: req.user.id,
    });

    const deleted = await activityService.deleteUserActivityHistory({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
    });

    logger.info(`[${requestId}] Activity history deleted`, { deleted });

    return res.status(200).json({ success: true, deleted });
  } catch (err) {
    logger.error(`[${requestId}] Delete activity history failed`, {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
});

router.post("/batch", async (req, res, next) => {
  const requestId = req.id;

  logger.info(`[${requestId}] Batch activity processing start`, {
    eventCount: req.body.events?.length,
  });

  try {
    const parsed = batchEventsSchema.safeParse(req.body);

    if (!parsed.success) {
      logger.warn(`[${requestId}] Batch validation failed`, {
        errors: parsed.error.flatten(),
      });

      return res.status(400).json(
        ApiResponse.error("VALIDATION_ERROR", {
          message: "Donnees de batch invalides",
          errors: parsed.error.flatten(),
        }),
      );
    }

    const userId = req.user.id;
    const organisationId = getOrganisationId(req);
    let processed = 0;
    const errors = [];

    // Group activity_post for createBatchActiveLogs
    const activityPosts = [];

    for (const event of parsed.data.events) {
      try {
        if (event.kind === "activity_post") {
          const payloadParsed = createActivitySchema.safeParse(event.payload);
          if (payloadParsed.success) {
            activityPosts.push(payloadParsed.data);
          } else {
            errors.push({ kind: event.kind, error: payloadParsed.error.flatten() });
          }
        } else if (event.kind === "activity_windows_post") {
          const payloadParsed = createWindowLogsSchema.safeParse(event.payload);
          if (payloadParsed.success) {
            await activityService.createBackgroundWindowLogs({
              userId,
              organisationId,
              data: payloadParsed.data,
              requestId,
            });
            processed++;
          } else {
            errors.push({ kind: event.kind, error: payloadParsed.error.flatten() });
          }
        } else if (event.kind === "activity_duration_patch") {
          const payloadParsed = updateActivityDurationSchema.safeParse(event.payload);
          if (payloadParsed.success && event.payload.activity_id) {
            await activityService.updateActivityDuration({
              activityId: event.payload.activity_id,
              userId,
              organisationId,
              data: payloadParsed.data,
              requestId,
            });
            processed++;
          } else {
            errors.push({
              kind: event.kind,
              error: "Invalid patch payload or missing activity_id",
            });
          }
        }
      } catch (e) {
        logger.error(`[${requestId}] Batch event processing failed`, {
          kind: event.kind,
          error: e.message,
        });
        errors.push({ kind: event.kind, error: e.message });
      }
    }

    if (activityPosts.length > 0) {
      const inserted = await activityService.createBatchActiveLogs({
        userId,
        organisationId,
        logs: activityPosts,
        requestId,
      });
      processed += inserted;
    }

    logger.info(`[${requestId}] Batch activity processing complete`, {
      processed,
      errorCount: errors.length,
    });

    // Check active timer for TDAH Nudges
    const activeTimer = await timerService.getActiveTimer({ userId, organisationId });

    return res.status(200).json({ success: true, processed, errors, hasActiveTimer: !!activeTimer });
  } catch (err) {
    logger.error(`[${requestId}] Batch activity failed`, {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  const requestId = req.id;

  logger.info(`[${requestId}] Create activity start`, {
    userId: req.user.id,
  });

  try {
    const parsed = createActivitySchema.safeParse(req.body);

    if (!parsed.success) {
      logger.warn(`[${requestId}] Activity validation failed`, {
        errors: parsed.error.flatten(),
      });

      return res.status(400).json(
        ApiResponse.error("VALIDATION_ERROR", {
          message: "Donnees invalides",
          errors: parsed.error.flatten(),
        }),
      );
    }

    const activity = await activityService.createActiveLog({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      data: parsed.data,
      requestId,
    });

    logger.info(`[${requestId}] Activity created`, {
      activityId: activity.id,
    });

    return res.status(201).json(activity);
  } catch (err) {
    logger.error(`[${requestId}] Create activity failed`, {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
});

router.post("/windows", async (req, res, next) => {
  const requestId = req.id;

  logger.info(`[${requestId}] Create window logs start`, {
    windowCount: req.body.windows?.length,
  });

  try {
    const parsed = createWindowLogsSchema.safeParse(req.body);

    if (!parsed.success) {
      logger.warn(`[${requestId}] Window logs validation failed`, {
        errors: parsed.error.flatten(),
      });

      return res.status(400).json(
        ApiResponse.error("VALIDATION_ERROR", {
          message: "Donnees invalides",
          errors: parsed.error.flatten(),
        }),
      );
    }

    if (parsed.data.windows.length === 0) {
      logger.info(`[${requestId}] No windows detected`);

      return res.status(200).json({
        success: true,
        inserted: 0,
        message: "Aucune fenetre detectee.",
      });
    }

    const inserted = await activityService.createBackgroundWindowLogs({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      data: parsed.data,
      requestId,
    });

    logger.info(`[${requestId}] Window logs created`, { inserted });

    return res.status(201).json({ inserted });
  } catch (err) {
    logger.error(`[${requestId}] Create window logs failed`, {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
});

router.patch("/:id/duration", async (req, res, next) => {
  const requestId = req.id;

  logger.info(`[${requestId}] Update activity duration start`, {
    activityId: req.params.id,
  });

  try {
    const params = idParamSchema.safeParse(req.params);

    if (!params.success) {
      logger.warn(`[${requestId}] ID validation failed`, {
        errors: params.error.flatten(),
      });

      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }

    const parsed = updateActivityDurationSchema.safeParse(req.body);

    if (!parsed.success) {
      logger.warn(`[${requestId}] Duration update validation failed`, {
        errors: parsed.error.flatten(),
      });

      return res.status(400).json(
        ApiResponse.error("VALIDATION_ERROR", {
          message: "Donnees invalides",
          errors: parsed.error.flatten(),
        }),
      );
    }

    const activity = await activityService.updateActivityDuration({
      activityId: params.data.id,
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      data: parsed.data,
      requestId,
    });

    if (!activity) {
      logger.warn(`[${requestId}] Activity not found`, {
        activityId: params.data.id,
      });

      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Activite introuvable." }));
    }

    logger.info(`[${requestId}] Activity duration updated`, {
      activityId: activity.id,
      newDuration: activity.duration_seconds,
    });

    return res.status(200).json(activity);
  } catch (err) {
    logger.error(`[${requestId}] Update activity duration failed`, {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
});

module.exports = router;
