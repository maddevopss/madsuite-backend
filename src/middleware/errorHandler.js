const logger = require("../config/logger");
const ApiResponse = require("../utils/apiResponse");
const { BlockClosureError } = require("../utils/blockClosureValidation");
const { TransitionValidationError } = require("../utils/transitionSchema");

const SENSITIVE_KEYS = [/password/i, /mot_de_passe/i, /token/i, /secret/i, /authorization/i, /cookie/i];

function sanitizeLogValue(value, depth = 0) {
  if (depth > 5) return "[Truncated]";
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item, depth + 1));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const isSensitive = SENSITIVE_KEYS.some((pattern) => pattern.test(key));
      return [key, isSensitive ? "[Redacted]" : sanitizeLogValue(item, depth + 1)];
    }),
  );
}

function formatBusinessError(err) {
  return {
    code: err?.code || err?.message || 'business.error',
    message: err?.message || 'Operation denied',
    details: err?.details || {},
  };
}

// Gestionnaire d'erreurs global Express — à monter en dernier dans server.js
module.exports = (err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== "production";
  const status = err.status || err.statusCode || 500;
  const code = err.apiCode || err.code || (status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR");
  const message = isDev ? err.message || "Erreur serveur" : "Erreur serveur";

  // En production, ne jamais logger le body (potentiellement sensible).
  const logPayload = {
    stack: err.stack,
    requestId: req.id,
    user: req.user?.id || "anonyme",
    ...(isDev ? { body: sanitizeLogValue(req.body) } : {}),
  };

  logger.error(`${req.method} ${req.path} — ${err.message}`, logPayload);

  // Pour BlockClosureError et TransitionValidationError, retourner le contrat standardisé
  if (err instanceof BlockClosureError || err instanceof TransitionValidationError) {
    return res.status(status).json(formatBusinessError(err));
  }

  // Sinon, utiliser le format ApiResponse existant
  res.status(status).json(ApiResponse.error(code, {
    message,
    requestId: req.id,
    ...(isDev && { stack: err.stack }),
  }));
};
