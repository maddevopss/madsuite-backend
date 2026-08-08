/**
 * Help Analytics Service
 * Phase 3.1 - Analytics
 * 
 * Handles tracking and retrieving analytics data for help articles
 * Tracks views, searches, and user engagement metrics
 */

const db = require("../../db");
const logger = require("../config/logger");

class HelpAnalyticsService {
  /**
   * Track an article view
   * @param {number} organisationId - Organization ID
   * @param {string} articleId - Article identifier
   * @param {number} userId - User ID (optional)
   * @param {string} searchQuery - Search query used to find article (optional)
   * @param {string} language - Article language (default: 'fr')
   * @returns {Promise<Object>} Tracking result
   */
  async trackArticleView(organisationId, articleId, userId = null, searchQuery = null, language = 'fr') {
    try {
      if (!organisationId || !articleId) {
        throw new Error('organisationId and articleId are required');
      }

      const query = `
        INSERT INTO help_analytics (
          organisation_id,
          article_id,
          user_id,
          search_query,
          language,
          view_count,
          last_viewed
        ) VALUES ($1, $2, $3, $4, $5, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (organisation_id, article_id, user_id, language)
        DO UPDATE SET
          view_count = help_analytics.view_count + 1,
          last_viewed = CURRENT_TIMESTAMP,
          search_query = COALESCE($4, help_analytics.search_query),
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `;

      const result = await db.query(query, [
        organisationId,
        articleId,
        userId,
        searchQuery,
        language
      ]);

      logger.info(`Article view tracked: ${articleId} for org ${organisationId}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error tracking article view:', error);
      throw error;
    }
  }

  /**
   * Get analytics for a specific article
   * @param {number} organisationId - Organization ID
   * @param {string} articleId - Article identifier
   * @param {string} language - Article language (default: 'fr')
   * @returns {Promise<Object>} Article analytics
   */
  async getArticleAnalytics(organisationId, articleId, language = 'fr') {
    try {
      const query = `
        SELECT
          article_id,
          language,
          COUNT(*) as total_views,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT search_query) as unique_searches,
          MAX(last_viewed) as last_viewed_at,
          DATE(MAX(created_at)) as last_tracked_date
        FROM help_analytics
        WHERE organisation_id = $1
          AND article_id = $2
          AND language = $3
        GROUP BY article_id, language;
      `;

      const result = await db.query(query, [organisationId, articleId, language]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting article analytics:', error);
      throw error;
    }
  }

  /**
   * Get top articles by views
   * @param {number} organisationId - Organization ID
   * @param {number} limit - Number of articles to return (default: 10)
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Array>} Top articles
   */
  async getTopArticles(organisationId, limit = 10, days = 30) {
    try {
      const query = `
        SELECT
          article_id,
          language,
          COUNT(*) as view_count,
          COUNT(DISTINCT user_id) as unique_users,
          MAX(last_viewed) as last_viewed_at
        FROM help_analytics
        WHERE organisation_id = $1
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY article_id, language
        ORDER BY view_count DESC
        LIMIT $2;
      `;

      const result = await db.query(query, [organisationId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting top articles:', error);
      throw error;
    }
  }

  /**
   * Get search queries analytics
   * @param {number} organisationId - Organization ID
   * @param {number} limit - Number of queries to return (default: 20)
   * @returns {Promise<Array>} Search queries with counts
   */
  async getSearchQueries(organisationId, limit = 20) {
    try {
      const query = `
        SELECT
          search_query,
          language,
          COUNT(*) as query_count,
          COUNT(DISTINCT user_id) as unique_users,
          MAX(created_at) as last_searched_at
        FROM help_analytics
        WHERE organisation_id = $1
          AND search_query IS NOT NULL
        GROUP BY search_query, language
        ORDER BY query_count DESC
        LIMIT $2;
      `;

      const result = await db.query(query, [organisationId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting search queries:', error);
      throw error;
    }
  }

  /**
   * Get least viewed articles
   * @param {number} organisationId - Organization ID
   * @param {number} limit - Number of articles to return (default: 10)
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Array>} Least viewed articles
   */
  async getLeastViewedArticles(organisationId, limit = 10, days = 30) {
    try {
      const query = `
        SELECT
          article_id,
          language,
          COUNT(*) as view_count,
          COUNT(DISTINCT user_id) as unique_users,
          MAX(last_viewed) as last_viewed_at
        FROM help_analytics
        WHERE organisation_id = $1
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY article_id, language
        ORDER BY view_count ASC
        LIMIT $2;
      `;

      const result = await db.query(query, [organisationId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting least viewed articles:', error);
      throw error;
    }
  }

  /**
   * Get user engagement metrics
   * @param {number} organisationId - Organization ID
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Object>} Engagement metrics
   */
  async getEngagementMetrics(organisationId, days = 30) {
    try {
      const query = `
        SELECT
          COUNT(*) as total_views,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT article_id) as articles_viewed,
          COUNT(DISTINCT search_query) as unique_searches,
          ROUND(AVG(view_count), 2) as avg_views_per_user,
          MAX(last_viewed) as last_activity_at
        FROM help_analytics
        WHERE organisation_id = $1
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days';
      `;

      const result = await db.query(query, [organisationId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting engagement metrics:', error);
      throw error;
    }
  }

  /**
   * Get analytics summary for all articles
   * @param {number} organisationId - Organization ID
   * @param {string} language - Article language (default: 'fr')
   * @returns {Promise<Array>} Analytics summary
   */
  async getAnalyticsSummary(organisationId, language = 'fr') {
    try {
      const query = `
        SELECT
          article_id,
          language,
          COUNT(*) as total_views,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT search_query) as unique_searches,
          MAX(last_viewed) as last_viewed_at,
          DATE(MAX(created_at)) as last_tracked_date
        FROM help_analytics
        WHERE organisation_id = $1
          AND language = $2
        GROUP BY article_id, language
        ORDER BY total_views DESC;
      `;

      const result = await db.query(query, [organisationId, language]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting analytics summary:', error);
      throw error;
    }
  }

  /**
   * Delete old analytics records (data retention)
   * @param {number} daysToKeep - Number of days to keep (default: 90)
   * @returns {Promise<number>} Number of deleted records
   */
  async deleteOldAnalytics(daysToKeep = 90) {
    try {
      const query = `
        DELETE FROM help_analytics
        WHERE created_at < CURRENT_DATE - INTERVAL '${daysToKeep} days';
      `;

      const result = await db.query(query);
      logger.info(`Deleted ${result.rowCount} old analytics records`);
      return result.rowCount;
    } catch (error) {
      logger.error('Error deleting old analytics:', error);
      throw error;
    }
  }
}

module.exports = new HelpAnalyticsService();
