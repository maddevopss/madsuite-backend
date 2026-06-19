const express = require("express");

const { requireOrganisation } = require("../middleware/organization.middleware");
const { startTimerSchema } = require("../validators/timer.validator");
const ApiResponse = require("../utils/apiResponse");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const timerService = require("../services/timer.service");

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
