const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");
const aiService = require("../services/ai.service");

const router = express.Router();

// Rate limit dédié IA : 20 requêtes/minute par organisation pour contrôler les coûts OpenAI.
// En test, le limiter est désactivé via skip.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === "development" ? 200 : 20,
  skip: () => process.env.NODE_ENV === "test",
  keyGenerator: (req) => `ai:org:${req.user?.organisation_id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Limite de l'assistant IA atteinte. Réessayez dans une minute." },
});

router.use(requireOrganisation);
router.use(aiLimiter);

// P0-5 fix: Rôles autorisés dans les messages client (injection de prompt système bloquée)
const ALLOWED_MESSAGE_ROLES = new Set(["user", "assistant"]);
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2000;

router.post("/chat", async (req, res, next) => {
  try {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "Le champ messages est requis et doit être un tableau." }));
    }

    // P0-5 fix: Filtrer les rôles non autorisés (system, tool, function, developer)
    // pour empêcher l'injection de prompt système via le client.
    const safeMessages = messages
      .filter((m) => m && typeof m === "object" && ALLOWED_MESSAGE_ROLES.has(m.role))
      .slice(-MAX_MESSAGES);

    if (safeMessages.length === 0) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "Aucun message valide fourni." }));
    }

    // Valider la longueur de chaque message
    for (const msg of safeMessages) {
      if (typeof msg.content !== "string" || msg.content.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "Un message dépasse la longueur maximale autorisée." }));
      }
    }

    const responseText = await aiService.askCopilot(
      safeMessages,
      req.user.organisation_id,
      req.user.id
    );

    return res.status(200).json(ApiResponse.success("COPILOT_RESPONSE", { reply: responseText }));
  } catch (err) {
    if (err.message.includes("OPENAI_API_KEY")) {
      return res.status(503).json(ApiResponse.error("SERVICE_UNAVAILABLE", { message: "L'assistant IA n'est pas configuré sur ce serveur." }));
    }
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
