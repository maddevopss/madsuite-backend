/**
 * Help Feedback Routes
 * Phase 3.2 - Feedback System
 * 
 * Routes for collecting and retrieving user feedback on help articles
 */

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const { getOrganisationId } = require("../utils/organisationScope");
const helpFeedbackService = require("../services/help-feedback.service");

/**
 * POST /api/help/feedback
 * Submit feedback for an article
 * Auth: Authenticated users
 */
router.post("/", auth, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const userId = req.user?.id;
    const { articleId, rating, comment, language } = req.body;

    if (!articleId || rating === undefined) {
      return res.status(400).json({ error: "articleId and rating are required" });
    }

    const feedback = await helpFeedbackService.submitFeedback(
      organisationId,
      articleId,
      userId,
      rating,
      comment,
      language || 'fr'
    );

    res.status(201).json({ success: true, data: feedback });
  } catch (error) {
    console.error("Error submitting feedback:", error);
    res.status(500).json({ error: error.message || "Failed to submit feedback" });
  }
});

/**
 * GET /api/help/feedback/article/:articleId
 * Get feedback for a specific article
 * Auth: Admin only
 */
router.get("/article/:articleId", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { articleId } = req.params;
    const { language } = req.query;

    const feedback = await helpFeedbackService.getArticleFeedback(
      organisationId,
      articleId,
      language || 'fr'
    );

    res.json({ success: true, data: feedback });
  } catch (error) {
    console.error("Error getting article feedback:", error);
    res.status(500).json({ error: "Failed to get article feedback" });
  }
});

/**
 * GET /api/help/feedback/summary/:articleId
 * Get feedback summary for an article
 * Auth: Admin only
 */
router.get("/summary/:articleId", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { articleId } = req.params;
    const { language } = req.query;

    const summary = await helpFeedbackService.getFeedbackSummary(
      organisationId,
      articleId,
      language || 'fr'
    );

    if (!summary) {
      return res.status(404).json({ error: "No feedback found for this article" });
    }

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error("Error getting feedback summary:", error);
    res.status(500).json({ error: "Failed to get feedback summary" });
  }
});

/**
 * GET /api/help/feedback/needs-improvement
 * Get articles needing improvement
 * Auth: Admin only
 */
router.get("/needs-improvement", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { limit, days } = req.query;

    const articles = await helpFeedbackService.getArticlesNeedingImprovement(
      organisationId,
      parseInt(limit) || 10,
      parseInt(days) || 30
    );

    res.json({ success: true, data: articles });
  } catch (error) {
    console.error("Error getting articles needing improvement:", error);
    res.status(500).json({ error: "Failed to get articles needing improvement" });
  }
});

/**
 * GET /api/help/feedback/with-comments
 * Get feedback with comments
 * Auth: Admin only
 */
router.get("/with-comments", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { limit } = req.query;

    const feedback = await helpFeedbackService.getFeedbackWithComments(
      organisationId,
      parseInt(limit) || 50
    );

    res.json({ success: true, data: feedback });
  } catch (error) {
    console.error("Error getting feedback with comments:", error);
    res.status(500).json({ error: "Failed to get feedback with comments" });
  }
});

/**
 * GET /api/help/feedback/statistics
 * Get feedback statistics
 * Auth: Admin only
 */
router.get("/statistics", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { days } = req.query;

    const stats = await helpFeedbackService.getFeedbackStatistics(
      organisationId,
      parseInt(days) || 30
    );

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error("Error getting feedback statistics:", error);
    res.status(500).json({ error: "Failed to get feedback statistics" });
  }
});

/**
 * GET /api/help/feedback/by-rating/:rating
 * Get feedback by rating
 * Auth: Admin only
 */
router.get("/by-rating/:rating", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { rating } = req.params;
    const { limit } = req.query;

    const feedback = await helpFeedbackService.getFeedbackByRating(
      organisationId,
      parseInt(rating),
      parseInt(limit) || 50
    );

    res.json({ success: true, data: feedback });
  } catch (error) {
    console.error("Error getting feedback by rating:", error);
    res.status(500).json({ error: error.message || "Failed to get feedback by rating" });
  }
});

module.exports = router;
