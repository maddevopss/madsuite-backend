/**
 * OpenAI Chat Service
 * Phase 3.3 - AI Chatbot
 * 
 * Handles OpenAI API integration for chatbot functionality
 * Manages conversation context, embeddings, and article suggestions
 */

const OpenAI = require("openai");
const logger = require("../config/logger");

class OpenAIChatService {
  constructor() {
    // The API is optional for core application startup.  Instantiate the
    // client only when the feature is configured; chat methods already
    // surface a configuration error when they are called without a key.
    this.client = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;
    this.model = process.env.OPENAI_MODEL || "gpt-4";
    this.maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS) || 2000;
    this.temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7;
  }

  /**
   * Create a system prompt for the chatbot
   * @param {string} language - Language code (fr, en, etc.)
   * @param {Array} suggestedArticles - Articles to include in context
   * @returns {string} System prompt
   */
  createSystemPrompt(language = 'fr', suggestedArticles = []) {
    const basePrompt = language === 'en'
      ? `You are a helpful AI assistant for MADSuite, a comprehensive business management platform. 
Your role is to:
1. Answer questions about MADSuite features and functionality
2. Provide clear, concise explanations
3. Suggest relevant help articles when appropriate
4. Be professional and friendly
5. If you don't know something, admit it and suggest checking the help documentation

Keep responses concise and focused. Use bullet points when listing multiple items.`
      : `Vous êtes un assistant IA utile pour MADSuite, une plateforme complète de gestion d'entreprise.
Votre rôle est de:
1. Répondre aux questions sur les fonctionnalités de MADSuite
2. Fournir des explications claires et concises
3. Suggérer des articles d'aide pertinents si nécessaire
4. Être professionnel et amical
5. Si vous ne savez pas quelque chose, admettez-le et suggérez de consulter la documentation

Gardez les réponses concises et ciblées. Utilisez des listes à puces pour énumérer plusieurs éléments.`;

    let contextPrompt = basePrompt;

    if (suggestedArticles && suggestedArticles.length > 0) {
      const articlesText = suggestedArticles
        .map(article => `- ${article.title}: ${article.description}`)
        .join('\n');

      contextPrompt += language === 'en'
        ? `\n\nRelevant help articles available:\n${articlesText}`
        : `\n\nArticles d'aide pertinents disponibles:\n${articlesText}`;
    }

    return contextPrompt;
  }

  /**
   * Send a message to OpenAI and get a response
   * @param {string} userMessage - User's message
   * @param {Array} conversationHistory - Previous messages in conversation
   * @param {string} language - Language code
   * @param {Array} suggestedArticles - Articles to include in context
   * @returns {Promise<Object>} Response from OpenAI
   */
  async sendMessage(userMessage, conversationHistory = [], language = 'fr', suggestedArticles = []) {
    try {
      if (!userMessage || userMessage.trim().length === 0) {
        throw new Error('User message cannot be empty');
      }

      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable is not set');
      }

      // Build conversation messages
      const messages = [
        ...conversationHistory,
        {
          role: 'user',
          content: userMessage,
        },
      ];

      // Create system prompt with context
      const systemPrompt = this.createSystemPrompt(language, suggestedArticles);

      // Call OpenAI API
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          ...messages,
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });

      if (!response.choices || response.choices.length === 0) {
        throw new Error('No response from OpenAI');
      }

      const assistantMessage = response.choices[0].message.content;
      const tokensUsed = response.usage?.total_tokens || 0;

      logger.info(`OpenAI response generated: ${tokensUsed} tokens used`);

      return {
        message: assistantMessage,
        tokensUsed,
        model: this.model,
        finishReason: response.choices[0].finish_reason,
      };
    } catch (error) {
      logger.error('Error calling OpenAI API:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for semantic search
   * @param {string} text - Text to embed
   * @returns {Promise<Array>} Embedding vector
   */
  async generateEmbedding(text) {
    try {
      if (!text || text.trim().length === 0) {
        throw new Error('Text cannot be empty');
      }

      const response = await this.client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('No embedding generated');
      }

      return response.data[0].embedding;
    } catch (error) {
      logger.error('Error generating embedding:', error);
      throw error;
    }
  }

  /**
   * Extract keywords from user message for article search
   * @param {string} userMessage - User's message
   * @param {string} language - Language code
   * @returns {Promise<Array>} Extracted keywords
   */
  async extractKeywords(userMessage, language = 'fr') {
    try {
      const prompt = language === 'en'
        ? `Extract 3-5 key search terms from this user message. Return only the keywords separated by commas, no explanation.\n\nMessage: "${userMessage}"`
        : `Extrayez 3-5 termes de recherche clés de ce message utilisateur. Retournez uniquement les mots-clés séparés par des virgules, pas d'explication.\n\nMessage: "${userMessage}"`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 100,
        temperature: 0.3,
      });

      const keywordsText = response.choices[0].message.content;
      const keywords = keywordsText
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);

      return keywords;
    } catch (error) {
      logger.error('Error extracting keywords:', error);
      // Return empty array on error instead of throwing
      return [];
    }
  }

  /**
   * Validate if a message is appropriate for the chatbot
   * @param {string} message - Message to validate
   * @returns {Promise<boolean>} Whether message is appropriate
   */
  async validateMessage(message) {
    try {
      // Basic validation
      if (!message || message.trim().length === 0) {
        return false;
      }

      if (message.length > 5000) {
        return false;
      }

      // Check for common spam patterns
      const spamPatterns = [
        /^[\s]*$/,  // Only whitespace
        /(.)\1{10,}/,  // Repeated characters
        /[^\w\s\p{L}]/gu,  // Too many special characters
      ];

      for (const pattern of spamPatterns) {
        if (pattern.test(message)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('Error validating message:', error);
      return false;
    }
  }

  /**
   * Calculate similarity between two texts using embeddings
   * @param {Array} embedding1 - First embedding vector
   * @param {Array} embedding2 - Second embedding vector
   * @returns {number} Similarity score (0-1)
   */
  calculateSimilarity(embedding1, embedding2) {
    try {
      if (!embedding1 || !embedding2 || embedding1.length !== embedding2.length) {
        return 0;
      }

      // Cosine similarity
      let dotProduct = 0;
      let magnitude1 = 0;
      let magnitude2 = 0;

      for (let i = 0; i < embedding1.length; i++) {
        dotProduct += embedding1[i] * embedding2[i];
        magnitude1 += embedding1[i] * embedding1[i];
        magnitude2 += embedding2[i] * embedding2[i];
      }

      magnitude1 = Math.sqrt(magnitude1);
      magnitude2 = Math.sqrt(magnitude2);

      if (magnitude1 === 0 || magnitude2 === 0) {
        return 0;
      }

      return dotProduct / (magnitude1 * magnitude2);
    } catch (error) {
      logger.error('Error calculating similarity:', error);
      return 0;
    }
  }

  /**
   * Format conversation history for API call
   * @param {Array} messages - Messages from database
   * @returns {Array} Formatted messages for OpenAI
   */
  formatConversationHistory(messages) {
    try {
      if (!Array.isArray(messages)) {
        return [];
      }

      return messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));
    } catch (error) {
      logger.error('Error formatting conversation history:', error);
      return [];
    }
  }

  /**
   * Check if API key is valid
   * @returns {Promise<boolean>} Whether API key is valid
   */
  async validateApiKey() {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return false;
      }

      // Try a simple API call to validate
      await this.client.models.list();
      return true;
    } catch (error) {
      logger.error('Error validating OpenAI API key:', error);
      return false;
    }
  }

  /**
   * Get model information
   * @returns {Object} Model information
   */
  getModelInfo() {
    return {
      model: this.model,
      maxTokens: this.maxTokens,
      temperature: this.temperature,
      apiKeyConfigured: !!process.env.OPENAI_API_KEY,
    };
  }
}

module.exports = new OpenAIChatService();
