/**
 * Help Analytics Routes
 * Phase 3.1 - Analytics
 * 
 * Routes for tracking and retrieving help article analytics
 */

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const { getOrganisationId } = require("../utils/organisationScope");
const helpAnalyticsService = require("../services/help-analytics.service");

/**
 * POST /api/help/analytics/track
 * Track an article view
 * Auth: Authenticated users
 */
router.post("/track", auth, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const userId = req.user?.id;
    const { articleId, searchQuery, language } = req.body;

    if (!articleId) {
      return res.status(400).json({ error: "articleId is required" });
    }

    const result = await helpAnalyticsService.trackArticleView(
      organisationId,
      articleId,
      userId,
      searchQuery,
      language || 'fr'
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error tracking article view:", error);
    res.status(500).json({ error: "Failed to track article view" });
  }
});

/**
 * GET /api/help/analytics/article/:articleId
 * Get analytics for a specific article
 * Auth: Admin only
 */
router.get("/article/:articleId", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { articleId } = req.params;
    const { language } = req.query;

    const analytics = await helpAnalyticsService.getArticleAnalytics(
      organisationId,
      articleId,
      language || 'fr'
    );

    if (!analytics) {
      return res.status(404).json({ error: "No analytics found for this article" });
    }

    res.json({ success: true, data: analytics });
  } catch (error) {
    console.error("Error getting article analytics:", error);
    res.status(500).json({ error: "Failed to get article analytics" });
  }
});

/**
 * GET /api/help/analytics/top-articles
 * Get top articles by views
 * Auth: Admin only
 */
router.get("/top-articles", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { limit, days } = req.query;

    const topArticles = await helpAnalyticsService.getTopArticles(
      organisationId,
      parseInt(limit) || 10,
      parseInt(days) || 30
    );

    res.json({ success: true, data: topArticles });
  } catch (error) {
    console.error("Error getting top articles:", error);
    res.status(500).json({ error: "Failed to get top articles" });
  }
});

/**
 * GET /api/help/analytics/least-viewed
 * Get least viewed articles
 * Auth: Admin only
 */
router.get("/least-viewed", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { limit, days } = req.query;

    const leastViewed = await helpAnalyticsService.getLeastViewedArticles(
      organisationId,
      parseInt(limit) || 10,
      parseInt(days) || 30
    );

    res.json({ success: true, data: leastViewed });
  } catch (error) {
    console.error("Error getting least viewed articles:", error);
    res.status(500).json({ error: "Failed to get least viewed articles" });
  }
});

/**
 * GET /api/help/analytics/search-queries
 * Get search queries analytics
 * Auth: Admin only
 */
router.get("/search-queries", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { limit } = req.query;

    const searchQueries = await helpAnalyticsService.getSearchQueries(
      organisationId,
      parseInt(limit) || 20
    );

    res.json({ success: true, data: searchQueries });
  } catch (error) {
    console.error("Error getting search queries:", error);
    res.status(500).json({ error: "Failed to get search queries" });
  }
});

/**
 * GET /api/help/analytics/engagement
 * Get user engagement metrics
 * Auth: Admin only
 */
router.get("/engagement", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { days } = req.query;

    const metrics = await helpAnalyticsService.getEngagementMetrics(
      organisationId,
      parseInt(days) || 30
    );

    res.json({ success: true, data: metrics });
  } catch (error) {
    console.error("Error getting engagement metrics:", error);
    res.status(500).json({ error: "Failed to get engagement metrics" });
  }
});

/**
 * GET /api/help/analytics/summary
 * Get analytics summary for all articles
 * Auth: Admin only
 */
router.get("/summary", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { language } = req.query;

    const summary = await helpAnalyticsService.getAnalyticsSummary(
      organisationId,
      language || 'fr'
    );

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error("Error getting analytics summary:", error);
    res.status(500).json({ error: "Failed to get analytics summary" });
  }
});

module.exports = router;
