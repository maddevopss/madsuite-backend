const express = require("express");
const router = express.Router();
const ApiResponse = require("../utils/apiResponse");
const { fetchAndParseICal, validateICalUrl } = require("../utils/icalParser");
const db = require("../../db");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");

router.use(requireOrganisation);

router.get("/events", async (req, res, next) => {
  try {
    const organisationId = getOrganisationId(req);
    const { rows } = await db.query(
      "SELECT ical_feed_url FROM utilisateurs WHERE id = $1 AND organisation_id = $2",
      [req.user.id, organisationId]
    );
    const url = rows[0]?.ical_feed_url;
    
    if (!url) {
      return res.status(200).json(ApiResponse.success("CALENDAR_NO_URL", []));
    }
    
    const events = await fetchAndParseICal(url);
    
    // Filtrer les événements pour ne garder que ceux de la semaine en cours ou très récents
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneWeekFuture = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const recentEvents = events.filter(e => {
      return e.start >= oneWeekAgo && e.start <= oneWeekFuture;
    }).slice(0, 100);

    return res.status(200).json(ApiResponse.success("CALENDAR_EVENTS", recentEvents));
  } catch (err) {
    next(err);
  }
});

router.put("/feed", async (req, res, next) => {
  try {
    const organisationId = getOrganisationId(req);
    const { ical_feed_url } = req.body;
    const safeUrl = validateICalUrl(ical_feed_url);

    if (!safeUrl) {
      return res.status(400).json(ApiResponse.error("CALENDAR_INVALID_URL", {
        message: "URL iCal invalide ou non autorisée.",
      }));
    }

    await db.query(
      "UPDATE utilisateurs SET ical_feed_url = $1 WHERE id = $2 AND organisation_id = $3",
      [safeUrl, req.user.id, organisationId]
    );
    return res.status(200).json(ApiResponse.success("CALENDAR_URL_UPDATED", { ical_feed_url: safeUrl }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
