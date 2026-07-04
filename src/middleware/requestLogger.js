const logger = require("../config/logger");
const { sanitizeUrlForLog } = require("../utils/sanitizeLog");

module.exports = function requestLogger(req, res, next) {
  const start = process.hrtime();
   
  res.on("finish", () => {
    const diff = process.hrtime(start);
    const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
    const url = sanitizeUrlForLog(req.originalUrl || req.url);
    
    const message = `${req.method} ${url} ${res.statusCode} ${durationMs}ms`;
    
    const meta = {
      method: req.method,
      url,
      status: res.statusCode,
      durationMs: Number(durationMs),
      ip: req.ip || req.connection?.remoteAddress,
      requestId: req.id,
      userId: req.user?.id
    };

    if (res.statusCode >= 500) {
      logger.error(message, meta);
    } else if (res.statusCode >= 400) {
      logger.warn(message, meta);
    } else {
      logger.info(message, meta);
    }
  });

  next();
};
