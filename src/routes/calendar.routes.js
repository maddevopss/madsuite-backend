const express = require("express");
const router = express.Router();
const ApiResponse = require("../utils/apiResponse");
const { fetchAndParseICal } = require("../utils/icalParser");
const db = require("../../db");

router.get("/events", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      "SELECT ical_feed_url FROM utilisateurs WHERE id = $1 AND organisation_id = $2",
      [req.user.id, req.user.organisation_id || req.organisationId]
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
    });

    return res.status(200).json(ApiResponse.success("CALENDAR_EVENTS", recentEvents));
  } catch (err) {
    next(err);
  }
});

router.put("/feed", async (req, res, next) => {
  try {
    const { ical_feed_url } = req.body;
    await db.query(
      "UPDATE utilisateurs SET ical_feed_url = $1 WHERE id = $2 AND organisation_id = $3",
      [ical_feed_url, req.user.id, req.user.organisation_id || req.organisationId]
    );
    return res.status(200).json(ApiResponse.success("CALENDAR_URL_UPDATED", { ical_feed_url }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
