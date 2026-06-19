const express = require("express");
const router = express.Router();

const { requireOrganisation } = require("../middleware/organization.middleware");
const dashboardService = require("../services/dashboard.service");
const ApiResponse = require("../utils/apiResponse");

router.use(requireOrganisation);

router.get("/", async (req, res, next) => {
  try {
    const rows = await dashboardService.listClientDashboard({
      userId: req.user.id,
      role: req.user.role,
      organisationId: req.organisationId,
    });

    return res.status(200).json(ApiResponse.success("DASHBOARD_LISTED", rows));
  } catch (err) {
    next(err);
  }
});

router.get("/activity/summary", async (req, res, next) => {
  const { date_debut: dateDebut, date_fin: dateFin } = req.query;

  if (!dateDebut || !dateFin) {
    return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
      message: "date_debut et date_fin sont obligatoires.",
    }));
  }

  try {
    const rows = await dashboardService.getActivitySummary({
      userId: req.user.id,
      organisationId: req.organisationId,
      dateDebut,
      dateFin,
    });

    return res.status(200).json(ApiResponse.success("DASHBOARD_ACTIVITY_SUMMARY_LISTED", rows));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
