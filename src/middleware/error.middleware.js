const logger = require("../config/logger");

/**
 * Middleware de gestion d'erreur global.
 * Il s'assure que toute erreur non gérée définit un code d'erreur HTTP.
 * Cela permet au transactionMiddleware de déclencher le ROLLBACK.
 */
function errorMiddleware(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Une erreur interne est survenue.";

  logger.error(`[ErrorMiddleware] ${statusCode} - ${message}`, { stack: err.stack });

  // En envoyant cette réponse, res.statusCode est mis à jour.
  // Le transactionMiddleware verra statusCode >= 400 lors de l'événement 'finish'.
  res.status(statusCode).json({ error: message });
}

module.exports = errorMiddleware;
