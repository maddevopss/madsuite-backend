const express = require("express");

const { requireOrganisation } = require("../middleware/organization.middleware");
const { startTimerSchema } = require("../validators/timer.validator");
const ApiResponse = require("../utils/apiResponse");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const timerService = require("../services/timer.service");
const activityService = require("../services/activity.service");

const router = express.Router();

router.use(requireOrganisation);

// TIMER ACTIF
router.get("/active", async (req, res, next) => {
  try {
    const timer = await timerService.getActiveTimer({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
    });

    const code = timer ? "TIMER_ACTIVE" : "NO_ACTIVE_TIMER";
    res.json(ApiResponse.success(code, timer));
  } catch (err) {
    return handleServiceError(err, res, next, { code: "TIMER_ACTIVE_FAILED" });
  }
});

// SYNC STATE (Replaces frontend polling logic)
router.get("/sync", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const organisationId = getOrganisationId(req);
    
    const timer = await timerService.getActiveTimer({ userId, organisationId });
    if (!timer) {
      return res.json(ApiResponse.success("SYNC_OK", { isRunning: false, activeEntry: null }));
    }

    const { 
      idleWarningSeconds = 270, 
      idleAutoPauseSeconds = 300, 
      autoPauseEnabled = 'false' 
    } = req.query;

    const latestActivity = await activityService.getLatestActiveLog({ userId, organisationId });
    
    const isAutoPauseEnabled = autoPauseEnabled === 'true';
    const warningSecs = Math.max(60, Number(idleWarningSeconds));
    const autoPauseSecs = Math.max(warningSecs + 30, Number(idleAutoPauseSeconds));

    if (latestActivity?.is_idle) {
      if (isAutoPauseEnabled && latestActivity.idle_seconds >= autoPauseSecs) {
        await timerService.stopTimer({ userId, organisationId });
        return res.json(ApiResponse.success("TIMER_AUTO_PAUSED", { 
          isRunning: false, 
          activeEntry: null,
          autoPaused: true,
          message: "Timer mis en pause pour inactivité."
        }));
      }

      if (latestActivity.idle_seconds >= warningSecs) {
        return res.json(ApiResponse.success("SYNC_OK", {
          isRunning: true,
          activeEntry: timer,
          idleWarning: true,
          message: "Inactivité détectée. Vérifie si ton timer roule encore."
        }));
      }
    }

    return res.json(ApiResponse.success("SYNC_OK", {
      isRunning: true,
      activeEntry: timer,
      idleWarning: false
    }));
  } catch (err) {
    return handleServiceError(err, res, next, { code: "TIMER_SYNC_FAILED" });
  }
});

// START TIMER
router.post("/start", async (req, res, next) => {
  try {
    const parsed = startTimerSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("TIMER_VALIDATION_FAILED", {
        message: "Données invalides",
        ...parsed.error.flatten(),
      }));
    }

    const timer = await timerService.startTimer({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      projetId: parsed.data.projet_id,
      description: parsed.data.description || null,
    });

    return res.status(201).json(ApiResponse.success("TIMER_STARTED", timer));
  } catch (err) {
    return handleServiceError(err, res, next, { code: "TIMER_START_FAILED" });
  }
});

// START UNSORTED TIMER (TDAH / Start Now, Sort Later)
router.post("/start-unsorted", async (req, res, next) => {
  try {
    const timer = await timerService.startUnsortedTimer({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      description: req.body?.description || null,
    });

    return res.status(201).json(ApiResponse.success("TIMER_STARTED_UNSORTED", timer));
  } catch (err) {
    return handleServiceError(err, res, next, { code: "TIMER_START_UNSORTED_FAILED" });
  }
});

// STOP TIMER
router.patch("/stop", async (req, res, next) => {
  try {
    const timer = await timerService.stopTimer({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
    });

    const code = timer ? "TIMER_STOPPED" : "NO_ACTIVE_TIMER";
    return res.json(ApiResponse.success(code, timer));
  } catch (err) {
    return handleServiceError(err, res, next, { code: "TIMER_STOP_FAILED" });
  }
});

// TODAY PROJECTS
router.get("/today-projects", async (req, res, next) => {
  try {
    const projects = await timerService.getTodayProjects({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
    });

    res.json(ApiResponse.success("TIMER_TODAY_PROJECTS", projects));
  } catch (err) {
    return handleServiceError(err, res, next, { code: "TIMER_TODAY_PROJECTS_FAILED" });
  }
});

// UPDATE NOTE ON ACTIVE TIMER
// THIS IS THE SINGLE SOURCE OF TRUTH for time_entries.note
// Activity layer (and any other module) MUST NOT write to timer notes.
router.patch("/active/note", async (req, res, next) => {
  try {
    const updated = await timerService.updateActiveTimerNote({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      note: req.body?.note,
    });

    res.json(ApiResponse.success("TIMER_NOTE_UPDATED", updated));
  } catch (err) {
    return handleServiceError(err, res, next, { code: "TIMER_NOTE_UPDATE_FAILED" });
  }
});

module.exports = router;
