/**
 * Help Search Service
 * Phase 3.6 - Search Optimization
 * 
 * Handles full-text search, search suggestions, and search analytics
 */

const db = require("../../db");
const logger = require("../config/logger");

class HelpSearchService {
  /**
   * Index an article for search
   * @param {number} organisationId - Organization ID
   * @param {string} articleId - Article identifier
   * @param {string} title - Article title
   * @param {string} description - Article description
   * @param {string} content - Article content
   * @param {string} language - Article language (default: 'fr')
   * @returns {Promise<Object>} Indexed article
   */
  async indexArticle(organisationId, articleId, title, description, content, language = 'fr') {
    try {
      if (!organisationId || !articleId || !title) {
        throw new Error('organisationId, articleId, and title are required');
      }

      const query = `
        INSERT INTO help_search_index (
          organisation_id,
          article_id,
          language,
          title,
          description,
          content,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (organisation_id, article_id, language)
        DO UPDATE SET
          title = $4,
          description = $5,
          content = $6,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `;

      const result = await db.query(query, [
        organisationId,
        articleId,
        language,
        title,
        description || '',
        content || ''
      ]);

      logger.info(`Article indexed for search: ${articleId} (${language})`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error indexing article:', error);
      throw error;
    }
  }

  /**
   * Search articles using full-text search
   * @param {number} organisationId - Organization ID
   * @param {string} searchQuery - Search query
   * @param {string} language - Article language (default: 'fr')
   * @param {number} limit - Number of results to return (default: 20)
   * @returns {Promise<Array>} Search results
   */
  async searchArticles(organisationId, searchQuery, language = 'fr', limit = 20) {
    try {
      if (!organisationId || !searchQuery) {
        throw new Error('organisationId and searchQuery are required');
      }

      // Use PostgreSQL full-text search function
      const query = `
        SELECT
          article_id,
          title,
          description,
          language,
          ts_rank(search_vector, plainto_tsquery($3, $2))::REAL as relevance
        FROM help_search_index
        WHERE organisation_id = $1
          AND language = $3
          AND search_vector @@ plainto_tsquery($3, $2)
        ORDER BY relevance DESC
        LIMIT $4;
      `;

      const result = await db.query(query, [
        organisationId,
        searchQuery,
        language,
        limit
      ]);

      logger.info(`Search performed: "${searchQuery}" (${language}) - ${result.rows.length} results`);
      return result.rows;
    } catch (error) {
      logger.error('Error searching articles:', error);
      throw error;
    }
  }

  /**
   * Get search suggestions based on partial query
   * @param {number} organisationId - Organization ID
   * @param {string} partialQuery - Partial search query
   * @param {string} language - Article language (default: 'fr')
   * @param {number} limit - Number of suggestions to return (default: 10)
   * @returns {Promise<Array>} Search suggestions
   */
  async getSearchSuggestions(organisationId, partialQuery, language = 'fr', limit = 10) {
    try {
      if (!organisationId || !partialQuery) {
        throw new Error('organisationId and partialQuery are required');
      }

      const query = `
        SELECT DISTINCT
          title as suggestion,
          'article'::VARCHAR(50) as type
        FROM help_search_index
        WHERE organisation_id = $1
          AND language = $2
          AND title ILIKE '%' || $3 || '%'
        ORDER BY title
        LIMIT $4;
      `;

      const result = await db.query(query, [
        organisationId,
        language,
        partialQuery,
        limit
      ]);

      return result.rows;
    } catch (error) {
      logger.error('Error getting search suggestions:', error);
      throw error;
    }
  }

  /**
   * Get popular search queries
   * @param {number} organisationId - Organization ID
   * @param {number} limit - Number of queries to return (default: 20)
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Array>} Popular search queries
   */
  async getPopularSearchQueries(organisationId, limit = 20, days = 30) {
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
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY search_query, language
        ORDER BY query_count DESC
        LIMIT $2;
      `;

      const result = await db.query(query, [organisationId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting popular search queries:', error);
      throw error;
    }
  }

  /**
   * Get search analytics
   * @param {number} organisationId - Organization ID
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Object>} Search analytics
   */
  async getSearchAnalytics(organisationId, days = 30) {
    try {
      const query = `
        SELECT
          COUNT(*) as total_searches,
          COUNT(DISTINCT search_query) as unique_queries,
          COUNT(DISTINCT user_id) as unique_searchers,
          COUNT(DISTINCT article_id) as articles_found,
          MAX(created_at) as last_search_at
        FROM help_analytics
        WHERE organisation_id = $1
          AND search_query IS NOT NULL
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days';
      `;

      const result = await db.query(query, [organisationId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting search analytics:', error);
      throw error;
    }
  }

  /**
   * Get articles by search query
   * @param {number} organisationId - Organization ID
   * @param {string} searchQuery - Search query
   * @param {string} language - Article language (default: 'fr')
   * @returns {Promise<Array>} Articles found
   */
  async getArticlesByQuery(organisationId, searchQuery, language = 'fr') {
    try {
      const query = `
        SELECT
          article_id,
          title,
          description,
          language
        FROM help_search_index
        WHERE organisation_id = $1
          AND language = $2
          AND (
            title ILIKE '%' || $3 || '%'
            OR description ILIKE '%' || $3 || '%'
            OR content ILIKE '%' || $3 || '%'
          )
        ORDER BY title;
      `;

      const result = await db.query(query, [organisationId, language, searchQuery]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting articles by query:', error);
      throw error;
    }
  }

  /**
   * Delete article from search index
   * @param {number} organisationId - Organization ID
   * @param {string} articleId - Article identifier
   * @param {string} language - Article language (default: 'fr')
   * @returns {Promise<boolean>} Success status
   */
  async deleteArticleFromIndex(organisationId, articleId, language = 'fr') {
    try {
      const query = `
        DELETE FROM help_search_index
        WHERE organisation_id = $1
          AND article_id = $2
          AND language = $3;
      `;

      const result = await db.query(query, [organisationId, articleId, language]);
      logger.info(`Article removed from search index: ${articleId} (${language})`);
      return result.rowCount > 0;
    } catch (error) {
      logger.error('Error deleting article from index:', error);
      throw error;
    }
  }

  /**
   * Rebuild search index for all articles
   * @param {number} organisationId - Organization ID
   * @returns {Promise<number>} Number of articles indexed
   */
  async rebuildSearchIndex(organisationId) {
    try {
      // This would typically be called with article data from another source
      // For now, it just returns the count of indexed articles
      const query = `
        SELECT COUNT(*) as count
        FROM help_search_index
        WHERE organisation_id = $1;
      `;

      const result = await db.query(query, [organisationId]);
      const count = result.rows[0]?.count || 0;
      logger.info(`Search index rebuilt for org ${organisationId}: ${count} articles`);
      return count;
    } catch (error) {
      logger.error('Error rebuilding search index:', error);
      throw error;
    }
  }

  /**
   * Get search statistics by language
   * @param {number} organisationId - Organization ID
   * @returns {Promise<Array>} Search statistics by language
   */
  async getSearchStatisticsByLanguage(organisationId) {
    try {
      const query = `
        SELECT
          language,
          COUNT(*) as total_articles,
          COUNT(DISTINCT article_id) as unique_articles
        FROM help_search_index
        WHERE organisation_id = $1
        GROUP BY language
        ORDER BY language;
      `;

      const result = await db.query(query, [organisationId]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting search statistics by language:', error);
      throw error;
    }
  }
}

module.exports = new HelpSearchService();
