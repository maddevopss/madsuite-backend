/**
 * Help Chat Routes
 * Phase 3.3 - AI Chatbot
 * 
 * Routes for AI chatbot functionality, conversation management, and article suggestions
 */

const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const { getOrganisationId } = require("../utils/organisationScope");
const helpChatService = require("../services/help-chat.service");
const helpSearchService = require("../services/help-search.service");
const openaiChatService = require("../services/openai-chat.service");

/**
 * POST /api/help/chat
 * Send a message to the chatbot
 * Auth: Authenticated users
 */
router.post("/", auth, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const userId = req.user?.id;
    const { message, sessionId, language = 'fr' } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Validate message
    const isValid = await openaiChatService.validateMessage(message);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid message format" });
    }

    // Create or get session
    let session;
    if (sessionId) {
      session = await helpChatService.getSession(organisationId, sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
    } else {
      session = await helpChatService.createSession(organisationId, userId, language);
    }

    // Store user message
    const userMessage = await helpChatService.addMessage(
      organisationId,
      session.session_id,
      userId,
      'user',
      message
    );

    // Get conversation history
    const conversationHistory = await helpChatService.getConversationHistory(
      organisationId,
      session.session_id,
      10
    );

    // Extract keywords for article search
    const keywords = await openaiChatService.extractKeywords(message, language);

    // Search for relevant articles
    let suggestedArticles = [];
    if (keywords.length > 0) {
      for (const keyword of keywords) {
        const results = await helpSearchService.searchArticles(
          organisationId,
          keyword,
          language,
          3
        );
        suggestedArticles = suggestedArticles.concat(results);
      }
      // Remove duplicates and limit to top 5
      suggestedArticles = Array.from(
        new Map(suggestedArticles.map(a => [a.article_id, a])).values()
      ).slice(0, 5);
    }

    // Get OpenAI response
    const aiResponse = await openaiChatService.sendMessage(
      message,
      conversationHistory,
      language,
      suggestedArticles
    );

    // Store assistant message
    const assistantMessage = await helpChatService.addMessage(
      organisationId,
      session.session_id,
      userId,
      'assistant',
      aiResponse.message,
      aiResponse.tokensUsed,
      aiResponse.model
    );

    // Store suggested articles
    if (suggestedArticles.length > 0) {
      await helpChatService.addSuggestedArticles(
        organisationId,
        session.session_id,
        assistantMessage.id,
        suggestedArticles.map(a => ({
          article_id: a.article_id,
          title: a.title,
          relevance_score: a.relevance || 0.5,
        }))
      );
    }

    res.json({
      success: true,
      data: {
        sessionId: session.session_id,
        message: aiResponse.message,
        suggestedArticles: suggestedArticles.map(a => ({
          id: a.article_id,
          title: a.title,
          description: a.description,
          relevance: a.relevance,
        })),
        tokensUsed: aiResponse.tokensUsed,
      },
    });
  } catch (error) {
    console.error("Error sending chat message:", error);
    res.status(500).json({ error: "Failed to process chat message" });
  }
});

/**
 * GET /api/help/chat/sessions
 * Get user's chat sessions
 * Auth: Authenticated users
 */
router.get("/sessions", auth, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const userId = req.user?.id;
    const { limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const sessions = await helpChatService.getUserSessions(
      organisationId,
      userId,
      parseInt(limit)
    );

    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error("Error getting chat sessions:", error);
    res.status(500).json({ error: "Failed to get chat sessions" });
  }
});

/**
 * GET /api/help/chat/history/:sessionId
 * Get chat history for a session
 * Auth: Authenticated users
 */
router.get("/history/:sessionId", auth, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { sessionId } = req.params;
    const { limit = 50 } = req.query;

    // Verify session exists and belongs to user's organization
    const session = await helpChatService.getSession(organisationId, sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const messages = await helpChatService.getMessages(
      organisationId,
      sessionId,
      parseInt(limit)
    );

    // Get suggested articles for each message
    const messagesWithArticles = await Promise.all(
      messages.map(async (msg) => ({
        ...msg,
        suggestedArticles: msg.role === 'assistant'
          ? await helpChatService.getSuggestedArticles(organisationId, msg.id)
          : [],
      }))
    );

    res.json({ success: true, data: messagesWithArticles });
  } catch (error) {
    console.error("Error getting chat history:", error);
    res.status(500).json({ error: "Failed to get chat history" });
  }
});

/**
 * DELETE /api/help/chat/sessions/:sessionId
 * Delete a chat session
 * Auth: Authenticated users
 */
router.delete("/sessions/:sessionId", auth, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { sessionId } = req.params;

    // Verify session exists and belongs to user's organization
    const session = await helpChatService.getSession(organisationId, sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const deleted = await helpChatService.deleteSession(organisationId, sessionId);

    if (!deleted) {
      return res.status(500).json({ error: "Failed to delete session" });
    }

    res.json({ success: true, message: "Session deleted successfully" });
  } catch (error) {
    console.error("Error deleting chat session:", error);
    res.status(500).json({ error: "Failed to delete chat session" });
  }
});

/**
 * PUT /api/help/chat/sessions/:sessionId/title
 * Update session title
 * Auth: Authenticated users
 */
router.put("/sessions/:sessionId/title", auth, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);
    const { sessionId } = req.params;
    const { title } = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: "Title is required" });
    }

    // Verify session exists and belongs to user's organization
    const session = await helpChatService.getSession(organisationId, sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const updated = await helpChatService.updateSessionTitle(
      organisationId,
      sessionId,
      title
    );

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating session title:", error);
    res.status(500).json({ error: "Failed to update session title" });
  }
});

/**
 * GET /api/help/chat/statistics
 * Get chat statistics (admin only)
 * Auth: Authenticated users
 */
router.get("/statistics", auth, async (req, res) => {
  try {
    const organisationId = getOrganisationId(req);

    const stats = await helpChatService.getStatistics(organisationId);

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error("Error getting chat statistics:", error);
    res.status(500).json({ error: "Failed to get chat statistics" });
  }
});

/**
 * GET /api/help/chat/model-info
 * Get OpenAI model information
 * Auth: Public
 */
router.get("/model-info", async (req, res) => {
  try {
    const modelInfo = openaiChatService.getModelInfo();

    res.json({ success: true, data: modelInfo });
  } catch (error) {
    console.error("Error getting model info:", error);
    res.status(500).json({ error: "Failed to get model info" });
  }
});

module.exports = router;
