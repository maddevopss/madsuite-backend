/**
 * Help Search Routes
 * Phase 3.6 - Search Optimization
 * 
 * Routes for full-text search, search suggestions, and search analytics
 */

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const { getOrganisationId } = require("../utils/organisationScope");
const helpSearchService = require("../services/help-search.service");

/**
 * POST /api/help/search/index
 * Index an article for search
 * Auth: Admin only
 */
router.post("/index", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { articleId, title, description, content, language } = req.body;

    if (!articleId || !title) {
      return res.status(400).json({ error: "articleId and title are required" });
    }

    const indexed = await helpSearchService.indexArticle(
      organisationId,
      articleId,
      title,
      description,
      content,
      language || 'fr'
    );

    res.json({ success: true, data: indexed });
  } catch (error) {
    console.error("Error indexing article:", error);
    res.status(500).json({ error: "Failed to index article" });
  }
});

/**
 * GET /api/help/search
 * Search articles using full-text search
 * Auth: Public (no authentication required)
 */
router.get("/", async (req, res) => {
  try {
    const { q, language, limit } = req.query;

    if (!q) {
      return res.status(400).json({ error: "Search query (q) is required" });
    }

    // For public search, we need to handle multi-tenant differently
    // This is a simplified version - in production, you might want to restrict this
    const organisationId = req.user ? getOrganisationId(req) : 1; // Default to org 1 for public

    const results = await helpSearchService.searchArticles(
      organisationId,
      q,
      language || 'fr',
      parseInt(limit) || 20
    );

    res.json({ success: true, data: results });
  } catch (error) {
    console.error("Error searching articles:", error);
    res.status(500).json({ error: "Failed to search articles" });
  }
});

/**
 * GET /api/help/search/suggestions
 * Get search suggestions based on partial query
 * Auth: Public (no authentication required)
 */
router.get("/suggestions", async (req, res) => {
  try {
    const { q, language, limit } = req.query;

    if (!q) {
      return res.status(400).json({ error: "Partial query (q) is required" });
    }

    // For public search, we need to handle multi-tenant differently
    const organisationId = req.user ? getOrganisationId(req) : 1; // Default to org 1 for public

    const suggestions = await helpSearchService.getSearchSuggestions(
      organisationId,
      q,
      language || 'fr',
      parseInt(limit) || 10
    );

    res.json({ success: true, data: suggestions });
  } catch (error) {
    console.error("Error getting search suggestions:", error);
    res.status(500).json({ error: "Failed to get search suggestions" });
  }
});

/**
 * GET /api/help/search/popular
 * Get popular search queries
 * Auth: Admin only
 */
router.get("/popular", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { limit, days } = req.query;

    const queries = await helpSearchService.getPopularSearchQueries(
      organisationId,
      parseInt(limit) || 20,
      parseInt(days) || 30
    );

    res.json({ success: true, data: queries });
  } catch (error) {
    console.error("Error getting popular search queries:", error);
    res.status(500).json({ error: "Failed to get popular search queries" });
  }
});

/**
 * GET /api/help/search/analytics
 * Get search analytics
 * Auth: Admin only
 */
router.get("/analytics", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { days } = req.query;

    const analytics = await helpSearchService.getSearchAnalytics(
      organisationId,
      parseInt(days) || 30
    );

    res.json({ success: true, data: analytics });
  } catch (error) {
    console.error("Error getting search analytics:", error);
    res.status(500).json({ error: "Failed to get search analytics" });
  }
});

/**
 * GET /api/help/search/by-query
 * Get articles by search query
 * Auth: Public (no authentication required)
 */
router.get("/by-query", async (req, res) => {
  try {
    const { q, language } = req.query;

    if (!q) {
      return res.status(400).json({ error: "Search query (q) is required" });
    }

    // For public search, we need to handle multi-tenant differently
    const organisationId = req.user ? getOrganisationId(req) : 1; // Default to org 1 for public

    const articles = await helpSearchService.getArticlesByQuery(
      organisationId,
      q,
      language || 'fr'
    );

    res.json({ success: true, data: articles });
  } catch (error) {
    console.error("Error getting articles by query:", error);
    res.status(500).json({ error: "Failed to get articles by query" });
  }
});

/**
 * DELETE /api/help/search/index/:articleId
 * Delete article from search index
 * Auth: Admin only
 */
router.delete("/index/:articleId", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { articleId } = req.params;
    const { language } = req.query;

    const deleted = await helpSearchService.deleteArticleFromIndex(
      organisationId,
      articleId,
      language || 'fr'
    );

    if (!deleted) {
      return res.status(404).json({ error: "Article not found in search index" });
    }

    res.json({ success: true, message: "Article removed from search index" });
  } catch (error) {
    console.error("Error deleting article from index:", error);
    res.status(500).json({ error: "Failed to delete article from index" });
  }
});

/**
 * POST /api/help/search/rebuild
 * Rebuild search index for all articles
 * Auth: Admin only
 */
router.post("/rebuild", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);

    const count = await helpSearchService.rebuildSearchIndex(organisationId);

    res.json({ success: true, message: `Search index rebuilt with ${count} articles` });
  } catch (error) {
    console.error("Error rebuilding search index:", error);
    res.status(500).json({ error: "Failed to rebuild search index" });
  }
});

/**
 * GET /api/help/search/statistics
 * Get search statistics by language
 * Auth: Admin only
 */
router.get("/statistics", auth, requireAdmin, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);

    const stats = await helpSearchService.getSearchStatisticsByLanguage(organisationId);

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error("Error getting search statistics:", error);
    res.status(500).json({ error: "Failed to get search statistics" });
  }
});

module.exports = router;
