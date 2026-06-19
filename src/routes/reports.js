const express = require("express");
const router = express.Router();

const requireRole = require("../middleware/requireRole");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const reportsService = require("../services/reports.service");
const ApiResponse = require("../utils/apiResponse");

router.use(requireOrganisation);

router.get("/", async (req, res, next) => {
  try {
    const { date_debut: dateDebut, date_fin: dateFin, is_billed: isBilled, group_by: groupBy } = req.query;

    if (!dateDebut || !dateFin) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Une date de debut et une date de fin sont obligatoires pour generer un rapport.",
      }));
    }

    const report = await reportsService.generateReport({
      userId: req.user.id,
      role: req.user.role,
      organisationId: getOrganisationId(req),
      dateDebut,
      dateFin,
      isBilled,
      groupBy,
    });

    return res.status(200).json(ApiResponse.success("REPORT_GENERATED", report));
  } catch (err) {
    next(err);
  }
});

if (process.env.NODE_ENV !== "production") {
  router.get("/debug/time_entries", requireRole("admin"), async (req, res, next) => {
    try {
      const rows = await reportsService.listDebugTimeEntries({
        organisationId: getOrganisationId(req),
      });

      return res.status(200).json(ApiResponse.success("DEBUG_TIME_ENTRIES_LISTED", rows));
    } catch (err) {
      next(err);
    }
  });

  router.get("/debug/activity_logs", requireRole("admin"), async (req, res, next) => {
    try {
      const rows = await reportsService.listDebugActivityLogs({
        organisationId: getOrganisationId(req),
        userId: req.user.id,
        type: "active",
      });

      return res.status(200).json(ApiResponse.success("DEBUG_ACTIVITY_LOGS_LISTED", rows));
    } catch (err) {
      next(err);
    }
  });

  router.get("/debug/window_logs", requireRole("admin"), async (req, res, next) => {
    try {
      const rows = await reportsService.listDebugActivityLogs({
        organisationId: getOrganisationId(req),
        userId: req.user.id,
        type: "background",
      });

      return res.status(200).json(ApiResponse.success("DEBUG_WINDOW_LOGS_LISTED", rows));
    } catch (err) {
      next(err);
    }
  });
}

module.exports = router;
