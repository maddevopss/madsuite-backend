/**
 * Help Chat Service
 * Phase 3.3 - AI Chatbot
 * 
 * Handles chat session management, message storage, and article suggestions
 */

const db = require("../../db");
const logger = require("../config/logger");
const { randomUUID } = require("node:crypto");

class HelpChatService {
  /**
   * Create a new chat session
   * @param {number} organisationId - Organization ID
   * @param {number} userId - User ID
   * @param {string} language - Language code (default: 'fr')
   * @param {string} title - Session title (optional)
   * @returns {Promise<Object>} Created session
   */
  async createSession(organisationId, userId, language = 'fr', title = null) {
    try {
      if (!organisationId) {
        throw new Error('organisationId is required');
      }

      const sessionId = randomUUID();
      const sessionTitle = title || `Chat ${new Date().toLocaleDateString()}`;

      const query = `
        INSERT INTO help_chat_sessions (
          organisation_id,
          user_id,
          session_id,
          language,
          title,
          created_at,
          updated_at,
          last_activity_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *;
      `;

      const result = await db.query(query, [
        organisationId,
        userId || null,
        sessionId,
        language,
        sessionTitle,
      ]);

      logger.info(`Chat session created: ${sessionId}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating chat session:', error);
      throw error;
    }
  }

  /**
   * Get a chat session
   * @param {number} organisationId - Organization ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Session data
   */
  async getSession(organisationId, sessionId) {
    try {
      const query = `
        SELECT *
        FROM help_chat_sessions
        WHERE organisation_id = $1
          AND session_id = $2;
      `;

      const result = await db.query(query, [organisationId, sessionId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting chat session:', error);
      throw error;
    }
  }

  /**
   * Get all sessions for a user
   * @param {number} organisationId - Organization ID
   * @param {number} userId - User ID
   * @param {number} limit - Number of sessions to return (default: 20)
   * @returns {Promise<Array>} User's sessions
   */
  async getUserSessions(organisationId, userId, limit = 20) {
    try {
      const query = `
        SELECT *
        FROM help_chat_active_sessions
        WHERE organisation_id = $1
          AND user_id = $2
        ORDER BY last_activity_at DESC
        LIMIT $3;
      `;

      const result = await db.query(query, [organisationId, userId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting user sessions:', error);
      throw error;
    }
  }

  /**
   * Add a message to a chat session
   * @param {number} organisationId - Organization ID
   * @param {string} sessionId - Session ID
   * @param {number} userId - User ID
   * @param {string} role - Message role (user or assistant)
   * @param {string} content - Message content
   * @param {number} tokensUsed - Tokens used (optional)
   * @param {string} model - Model used (optional)
   * @returns {Promise<Object>} Created message
   */
  async addMessage(organisationId, sessionId, userId, role, content, tokensUsed = null, model = null) {
    try {
      if (!organisationId || !sessionId || !role || !content) {
        throw new Error('organisationId, sessionId, role, and content are required');
      }

      if (!['user', 'assistant'].includes(role)) {
        throw new Error('role must be either "user" or "assistant"');
      }

      const query = `
        INSERT INTO help_chat_messages (
          organisation_id,
          session_id,
          user_id,
          role,
          content,
          tokens_used,
          model,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        RETURNING *;
      `;

      const result = await db.query(query, [
        organisationId,
        sessionId,
        userId || null,
        role,
        content,
        tokensUsed,
        model,
      ]);

      logger.info(`Message added to session ${sessionId}: ${role}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error adding message:', error);
      throw error;
    }
  }

  /**
   * Get messages from a chat session
   * @param {number} organisationId - Organization ID
   * @param {string} sessionId - Session ID
   * @param {number} limit - Number of messages to return (default: 50)
   * @returns {Promise<Array>} Messages
   */
  async getMessages(organisationId, sessionId, limit = 50) {
    try {
      const query = `
        SELECT *
        FROM help_chat_messages
        WHERE organisation_id = $1
          AND session_id = $2
        ORDER BY created_at ASC
        LIMIT $3;
      `;

      const result = await db.query(query, [organisationId, sessionId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting messages:', error);
      throw error;
    }
  }

  /**
   * Add suggested articles to a message
   * @param {number} organisationId - Organization ID
   * @param {string} sessionId - Session ID
   * @param {number} messageId - Message ID
   * @param {Array} articles - Articles to suggest
   * @returns {Promise<Array>} Created suggestions
   */
  async addSuggestedArticles(organisationId, sessionId, messageId, articles) {
    try {
      if (!organisationId || !sessionId || !messageId || !Array.isArray(articles)) {
        throw new Error('organisationId, sessionId, messageId, and articles array are required');
      }

      if (articles.length === 0) {
        return [];
      }

      const values = articles
        .map((article, index) => `($1, $2, $3, $${index * 4 + 4}, $${index * 4 + 5}, $${index * 4 + 6})`)
        .join(',');

      const params = [organisationId, sessionId, messageId];
      articles.forEach(article => {
        params.push(article.article_id);
        params.push(article.title);
        params.push(article.relevance_score || 0.5);
      });

      const query = `
        INSERT INTO help_chat_context (
          organisation_id,
          session_id,
          message_id,
          article_id,
          article_title,
          relevance_score,
          suggested_at
        ) VALUES ${values}
        RETURNING *;
      `;

      const result = await db.query(query, params);
      logger.info(`${result.rows.length} articles suggested for message ${messageId}`);
      return result.rows;
    } catch (error) {
      logger.error('Error adding suggested articles:', error);
      throw error;
    }
  }

  /**
   * Get suggested articles for a message
   * @param {number} organisationId - Organization ID
   * @param {number} messageId - Message ID
   * @returns {Promise<Array>} Suggested articles
   */
  async getSuggestedArticles(organisationId, messageId) {
    try {
      const query = `
        SELECT *
        FROM help_chat_context
        WHERE organisation_id = $1
          AND message_id = $2
        ORDER BY relevance_score DESC;
      `;

      const result = await db.query(query, [organisationId, messageId]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting suggested articles:', error);
      throw error;
    }
  }

  /**
   * Delete a chat session
   * @param {number} organisationId - Organization ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteSession(organisationId, sessionId) {
    try {
      const query = `
        DELETE FROM help_chat_sessions
        WHERE organisation_id = $1
          AND session_id = $2;
      `;

      const result = await db.query(query, [organisationId, sessionId]);
      logger.info(`Chat session deleted: ${sessionId}`);
      return result.rowCount > 0;
    } catch (error) {
      logger.error('Error deleting chat session:', error);
      throw error;
    }
  }

  /**
   * Get chat statistics
   * @param {number} organisationId - Organization ID
   * @returns {Promise<Object>} Chat statistics
   */
  async getStatistics(organisationId) {
    try {
      const query = `
        SELECT *
        FROM help_chat_statistics
        WHERE organisation_id = $1;
      `;

      const result = await db.query(query, [organisationId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting chat statistics:', error);
      throw error;
    }
  }

  /**
   * Cleanup old chat sessions (retention policy)
   * @param {number} organisationId - Organization ID
   * @param {number} retentionDays - Number of days to retain (default: 30)
   * @returns {Promise<number>} Number of deleted sessions
   */
  async cleanupOldSessions(organisationId, retentionDays = 30) {
    try {
      const query = `
        SELECT cleanup_old_chat_sessions($1)::INTEGER as deleted_count;
      `;

      const result = await db.query(query, [retentionDays]);
      const deletedCount = result.rows[0]?.deleted_count || 0;
      logger.info(`Cleaned up ${deletedCount} old chat sessions`);
      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up old sessions:', error);
      throw error;
    }
  }

  /**
   * Get conversation history for OpenAI
   * @param {number} organisationId - Organization ID
   * @param {string} sessionId - Session ID
   * @param {number} limit - Number of messages to include (default: 10)
   * @returns {Promise<Array>} Formatted conversation history
   */
  async getConversationHistory(organisationId, sessionId, limit = 10) {
    try {
      const query = `
        SELECT role, content
        FROM help_chat_messages
        WHERE organisation_id = $1
          AND session_id = $2
        ORDER BY created_at DESC
        LIMIT $3;
      `;

      const result = await db.query(query, [organisationId, sessionId, limit]);
      
      // Reverse to get chronological order
      return result.rows.reverse().map(msg => ({
        role: msg.role,
        content: msg.content,
      }));
    } catch (error) {
      logger.error('Error getting conversation history:', error);
      throw error;
    }
  }

  /**
   * Update session title
   * @param {number} organisationId - Organization ID
   * @param {string} sessionId - Session ID
   * @param {string} title - New title
   * @returns {Promise<Object>} Updated session
   */
  async updateSessionTitle(organisationId, sessionId, title) {
    try {
      const query = `
        UPDATE help_chat_sessions
        SET title = $3, updated_at = CURRENT_TIMESTAMP
        WHERE organisation_id = $1
          AND session_id = $2
        RETURNING *;
      `;

      const result = await db.query(query, [organisationId, sessionId, title]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating session title:', error);
      throw error;
    }
  }

  /**
   * Get total tokens used in a session
   * @param {number} organisationId - Organization ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<number>} Total tokens
   */
  async getSessionTokensUsed(organisationId, sessionId) {
    try {
      const query = `
        SELECT COALESCE(SUM(tokens_used), 0) as total_tokens
        FROM help_chat_messages
        WHERE organisation_id = $1
          AND session_id = $2;
      `;

      const result = await db.query(query, [organisationId, sessionId]);
      return result.rows[0]?.total_tokens || 0;
    } catch (error) {
      logger.error('Error getting session tokens:', error);
      throw error;
    }
  }
}

module.exports = new HelpChatService();
