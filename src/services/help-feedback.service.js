/**
 * Help Feedback Service
 * Phase 3.2 - Feedback System
 * 
 * Handles collecting and retrieving user feedback on help articles
 * Stores ratings (👍/👎) and optional comments
 */

const db = require("../../db");
const logger = require("../config/logger");

class HelpFeedbackService {
  /**
   * Submit feedback for an article
   * @param {number} organisationId - Organization ID
   * @param {string} articleId - Article identifier
   * @param {number} userId - User ID
   * @param {number} rating - Rating: 1 for helpful (👍), -1 for not helpful (👎)
   * @param {string} comment - Optional comment (max 1000 chars)
   * @param {string} language - Article language (default: 'fr')
   * @returns {Promise<Object>} Feedback record
   */
  async submitFeedback(organisationId, articleId, userId, rating, comment = null, language = 'fr') {
    try {
      if (!organisationId || !articleId || !userId) {
        throw new Error('organisationId, articleId, and userId are required');
      }

      if (![1, -1].includes(rating)) {
        throw new Error('rating must be 1 (helpful) or -1 (not helpful)');
      }

      // Sanitize comment
      let sanitizedComment = null;
      if (comment) {
        sanitizedComment = comment.trim().slice(0, 1000);
        if (sanitizedComment.length === 0) {
          sanitizedComment = null;
        }
      }

      const query = `
        INSERT INTO help_feedback (
          organisation_id,
          article_id,
          user_id,
          rating,
          comment,
          language,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *;
      `;

      const result = await db.query(query, [
        organisationId,
        articleId,
        userId,
        rating,
        sanitizedComment,
        language
      ]);

      logger.info(`Feedback submitted for article ${articleId} by user ${userId}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error submitting feedback:', error);
      throw error;
    }
  }

  /**
   * Get feedback for a specific article
   * @param {number} organisationId - Organization ID
   * @param {string} articleId - Article identifier
   * @param {string} language - Article language (default: 'fr')
   * @returns {Promise<Array>} Feedback records
   */
  async getArticleFeedback(organisationId, articleId, language = 'fr') {
    try {
      const query = `
        SELECT
          id,
          article_id,
          rating,
          comment,
          language,
          created_at
        FROM help_feedback
        WHERE organisation_id = $1
          AND article_id = $2
          AND language = $3
        ORDER BY created_at DESC;
      `;

      const result = await db.query(query, [organisationId, articleId, language]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting article feedback:', error);
      throw error;
    }
  }

  /**
   * Get feedback summary for an article
   * @param {number} organisationId - Organization ID
   * @param {string} articleId - Article identifier
   * @param {string} language - Article language (default: 'fr')
   * @returns {Promise<Object>} Feedback summary
   */
  async getFeedbackSummary(organisationId, articleId, language = 'fr') {
    try {
      const query = `
        SELECT
          article_id,
          language,
          COUNT(*) as total_feedback,
          SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as positive_count,
          SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as negative_count,
          ROUND(
            (SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)::NUMERIC / COUNT(*)) * 100,
            2
          ) as positive_percentage,
          MAX(created_at) as last_feedback_at
        FROM help_feedback
        WHERE organisation_id = $1
          AND article_id = $2
          AND language = $3
        GROUP BY article_id, language;
      `;

      const result = await db.query(query, [organisationId, articleId, language]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting feedback summary:', error);
      throw error;
    }
  }

  /**
   * Get articles needing improvement (most negative feedback)
   * @param {number} organisationId - Organization ID
   * @param {number} limit - Number of articles to return (default: 10)
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Array>} Articles needing improvement
   */
  async getArticlesNeedingImprovement(organisationId, limit = 10, days = 30) {
    try {
      const query = `
        SELECT
          article_id,
          language,
          COUNT(*) as total_feedback,
          SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as negative_count,
          ROUND(
            (SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END)::NUMERIC / COUNT(*)) * 100,
            2
          ) as negative_percentage
        FROM help_feedback
        WHERE organisation_id = $1
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY article_id, language
        HAVING SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) > 0
        ORDER BY negative_count DESC
        LIMIT $2;
      `;

      const result = await db.query(query, [organisationId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting articles needing improvement:', error);
      throw error;
    }
  }

  /**
   * Get feedback with comments
   * @param {number} organisationId - Organization ID
   * @param {number} limit - Number of records to return (default: 50)
   * @returns {Promise<Array>} Feedback records with comments
   */
  async getFeedbackWithComments(organisationId, limit = 50) {
    try {
      const query = `
        SELECT
          id,
          article_id,
          user_id,
          rating,
          comment,
          language,
          created_at
        FROM help_feedback
        WHERE organisation_id = $1
          AND comment IS NOT NULL
          AND comment != ''
        ORDER BY created_at DESC
        LIMIT $2;
      `;

      const result = await db.query(query, [organisationId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting feedback with comments:', error);
      throw error;
    }
  }

  /**
   * Get feedback statistics
   * @param {number} organisationId - Organization ID
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Object>} Feedback statistics
   */
  async getFeedbackStatistics(organisationId, days = 30) {
    try {
      const query = `
        SELECT
          COUNT(*) as total_feedback,
          SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as positive_count,
          SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as negative_count,
          COUNT(DISTINCT article_id) as articles_with_feedback,
          COUNT(DISTINCT user_id) as users_providing_feedback,
          ROUND(
            (SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)::NUMERIC / COUNT(*)) * 100,
            2
          ) as positive_percentage,
          MAX(created_at) as last_feedback_at
        FROM help_feedback
        WHERE organisation_id = $1
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days';
      `;

      const result = await db.query(query, [organisationId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting feedback statistics:', error);
      throw error;
    }
  }

  /**
   * Get feedback by rating
   * @param {number} organisationId - Organization ID
   * @param {number} rating - Rating to filter by (1 or -1)
   * @param {number} limit - Number of records to return (default: 50)
   * @returns {Promise<Array>} Feedback records
   */
  async getFeedbackByRating(organisationId, rating, limit = 50) {
    try {
      if (![1, -1].includes(rating)) {
        throw new Error('rating must be 1 (helpful) or -1 (not helpful)');
      }

      const query = `
        SELECT
          id,
          article_id,
          user_id,
          rating,
          comment,
          language,
          created_at
        FROM help_feedback
        WHERE organisation_id = $1
          AND rating = $2
        ORDER BY created_at DESC
        LIMIT $3;
      `;

      const result = await db.query(query, [organisationId, rating, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting feedback by rating:', error);
      throw error;
    }
  }

  /**
   * Delete old feedback records (data retention)
   * @param {number} daysToKeep - Number of days to keep (default: 180)
   * @returns {Promise<number>} Number of deleted records
   */
  async deleteOldFeedback(daysToKeep = 180) {
    try {
      const query = `
        DELETE FROM help_feedback
        WHERE created_at < CURRENT_DATE - INTERVAL '${daysToKeep} days';
      `;

      const result = await db.query(query);
      logger.info(`Deleted ${result.rowCount} old feedback records`);
      return result.rowCount;
    } catch (error) {
      logger.error('Error deleting old feedback:', error);
      throw error;
    }
  }
}

module.exports = new HelpFeedbackService();
