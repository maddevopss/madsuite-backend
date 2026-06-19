const express = require("express");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");
const aiService = require("../services/ai.service");

const router = express.Router();

router.use(requireOrganisation);

router.post("/chat", async (req, res, next) => {
  try {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "Le champ messages est requis et doit être un tableau." }));
    }

    // Le dernier message ne doit pas dépasser une certaine limite pour la sécurité
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.content.length > 2000) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "Le message est trop long." }));
    }

    const responseText = await aiService.askCopilot(
      messages,
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
