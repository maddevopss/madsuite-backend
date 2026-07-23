const { randomUUID } = require("node:crypto");
const logger = require("../config/logger");

/**
 * Middleware to add unique request ID to each request
 * Allows tracing through logs and database
 */
function requestIdMiddleware(req, res, next) {
  // Check if forwarded from upstream (nginx, LB, etc)
  const requestId = req.headers["x-request-id"] || req.headers["x-correlation-id"] || randomUUID();

  req.id = requestId;
  req.startTime = Date.now();

  // Add to response headers
  res.setHeader("X-Request-ID", requestId);

  // Override logger to add requestId to all logs
  const originalLog = logger.log.bind(logger);
  logger.log = function (level, message, meta = {}) {
    const enhanced = {
      ...meta,
      requestId,
      method: req.method,
      path: req.path,
    };
    return originalLog(level, message, enhanced);
  };

  // Log request start
  logger.debug(`[${requestId}] ${req.method} ${req.path}`, {
    ip: req.ip,
    userId: req.user?.id,
    organisationId: req.organisationId,
  });

  // Log response on finish
  res.on("finish", () => {
    const duration = Date.now() - req.startTime;
    const logLevel = res.statusCode >= 400 ? "warn" : "info";

    logger[logLevel](`[${requestId}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });

  next();
}

module.exports = requestIdMiddleware;
