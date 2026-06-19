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
const ApiResponse = require("../utils/apiResponse");

const router = express.Router();

router.delete("/history", async (req, res, next) => {
  try {
    const deleted = await activityService.deleteUserActivityHistory({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json({ success: true, deleted });
  } catch (err) {
    next(err);
  }
});

router.post("/batch", async (req, res, next) => {
  try {
    const parsed = batchEventsSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees de batch invalides",
        errors: parsed.error.flatten(),
      }));
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
            await activityService.createBackgroundWindowLogs({ userId, organisationId, data: payloadParsed.data });
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
            });
            processed++;
          } else {
            errors.push({ kind: event.kind, error: "Invalid patch payload or missing activity_id" });
          }
        }
      } catch (e) {
        errors.push({ kind: event.kind, error: e.message });
      }
    }
    
    if (activityPosts.length > 0) {
      const inserted = await activityService.createBatchActiveLogs({ userId, organisationId, logs: activityPosts });
      processed += inserted;
    }
    
    return res.status(200).json({ success: true, processed, errors });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = createActivitySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const activity = await activityService.createActiveLog({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      data: parsed.data,
    });

    return res.status(201).json(activity);
  } catch (err) {
    next(err);
  }
});

router.post("/windows", async (req, res, next) => {
  try {
    const parsed = createWindowLogsSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    if (parsed.data.windows.length === 0) {
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
    });

    return res.status(201).json({ inserted });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/duration", async (req, res, next) => {
  try {
    const params = idParamSchema.safeParse(req.params);

    if (!params.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }

    const parsed = updateActivityDurationSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const activity = await activityService.updateActivityDuration({
      activityId: params.data.id,
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      data: parsed.data,
    });

    if (!activity) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Activite introuvable." }));
    }

    return res.status(200).json(activity);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
