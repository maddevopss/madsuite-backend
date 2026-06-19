const express = require("express");

const { getOrganisationId } = require("../utils/organisationScope");
const activityService = require("../services/activity.service");
const ApiResponse = require("../utils/apiResponse");

const router = express.Router();

router.get("/recent", async (req, res, next) => {
  try {
    const rows = await activityService.listRecentActiveLogs({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/latest", async (req, res, next) => {
  try {
    const latest = await activityService.getLatestActiveLog({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json(latest);
  } catch (err) {
    next(err);
  }
});

router.get("/summary", async (req, res, next) => {
  try {
    const { date_debut, date_fin } = req.query;

    if (!date_debut || !date_fin) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "date_debut et date_fin sont obligatoires.",
      }));
    }

    const rows = await activityService.getDailySummary({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      dateDebut: date_debut,
      dateFin: date_fin,
    });

    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
