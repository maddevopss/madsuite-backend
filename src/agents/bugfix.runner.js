const fs = require("fs");
const path = require("path");

const aiService = require("../services/ai.service");

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function loadBugfixInstructions() {
  const candidates = [
    path.resolve(__dirname, "../../../bugfix.agent.md"),
    path.resolve(__dirname, "../../../backend/bugfix.agent.md"),
    path.resolve(__dirname, "../../..", "bugfix.agent.md"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  }

  // Fallback minimal instructions so endpoint still works even if md absent.
  // (But we also surface a warning in the returned JSON.)
  return null;
}

async function runBugfixAgent({ description, context }) {
  const instructions = loadBugfixInstructions();

  const userInput = {
    description: description || "",
    context: context || "",
  };

  const fallback = {
    rootCause: null,
    fix: null,
    riskLevel: "unknown",
    affectedFiles: [],
    warning: instructions ? undefined : "bugfix.agent.md introuvable; fallback minimal utilisé.",
  };

  // If AI not configured, return fallback with clear message.
  if (!aiService?.isAIEnabled || !aiService.isAIEnabled()) {
    return {
      ...fallback,
      rootCause: "IA non activée (OPENAI_API_KEY manquant).",
      fix: "Configurer OPENAI_API_KEY pour exécuter l’agent.",
      riskLevel: "high",
    };
  }

  // Use existing Copilot-like infrastructure; we only need a JSON-ish answer.
  const messages = [
    {
      role: "system",
      content: [
        "Tu es un agent BUGFIX minimal pour MADSuite.",
        "But: répondre en JSON strict avec clés rootCause, fix, riskLevel, affectedFiles.",
        "Exécute les instructions fournies dans bugfix.agent.md si disponibles.",
        instructions ? `\nINSTRUCTIONS:\n${instructions}` : "",
        "\nContraintes:",
        "- rootCause: 1-3 phrases",
        "- fix: 1-6 bullet points (ou un bloc court)",
        "- riskLevel: low | medium | high",
        "- affectedFiles: tableau de chemins (string)",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(userInput, null, 2),
    },
  ];

  // ai.service.js expose askCopilot(messages, organisationId, userId) but we don't have those.
  // We'll call getOpenAI directly through ai.service when possible.
  // Minimal approach: call ai.service.askCopilot with null IDs (handled by read-only tools only).
  const organisationId = null;
  const userId = null;

  const raw = await aiService.askCopilot(messages, organisationId, userId);
  const parsed = safeJsonParse(raw);

  if (!parsed) {
    return {
      ...fallback,
      rootCause: "Réponse IA non parsable en JSON.",
      fix: raw,
      riskLevel: "medium",
      affectedFiles: [],
    };
  }

  return {
    rootCause: parsed.rootCause ?? null,
    fix: parsed.fix ?? null,
    riskLevel: parsed.riskLevel ?? "unknown",
    affectedFiles: Array.isArray(parsed.affectedFiles) ? parsed.affectedFiles : [],
    warning: parsed.warning,
  };
}

module.exports = {
  runBugfixAgent,
};
