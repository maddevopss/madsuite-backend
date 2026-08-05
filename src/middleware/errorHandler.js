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

// Violation de contrainte UNIQUE Postgres (ex: rejeu d'une même Idempotency-Key
// après une interruption réseau, ou double soumission concurrente) : le driver
// pg expose err.code='23505' et err.constraint. Sans ce mapping, ces erreurs
// remontaient telles quelles — 500 générique avec le texte brut Postgres
// (nom de contrainte, structure de table) renvoyé au client. La ligne en
// double n'est jamais créée (la contrainte l'empêche), mais le client ne peut
// pas distinguer "conflit attendu, retente en toute sécurité" d'une vraie
// panne serveur, et le nom interne de la contrainte ne devrait pas fuiter.
function mapUniqueViolation(err) {
  if (err?.code !== "23505") return null;
  const isIdempotencyReplay = typeof err.constraint === "string" && err.constraint.includes("idempotency_key");
  return {
    statusCode: 409,
    code: isIdempotencyReplay ? "IDEMPOTENCY_KEY_ALREADY_USED" : "UNIQUE_CONSTRAINT_VIOLATION",
    message: isIdempotencyReplay
      ? "Cette clé d'idempotence a déjà été utilisée pour une requête précédente."
      : "Cette ressource existe déjà (contrainte d'unicité).",
  };
}

// Gestionnaire d'erreurs global Express — à monter en dernier dans server.js
module.exports = (err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== "production";
  const uniqueViolation = mapUniqueViolation(err);
  const status = uniqueViolation?.statusCode || err.status || err.statusCode || 500;
  const code = uniqueViolation?.code || err.apiCode || err.code || (status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR");
  const message = uniqueViolation?.message || (isDev ? err.message || "Erreur serveur" : "Erreur serveur");

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
