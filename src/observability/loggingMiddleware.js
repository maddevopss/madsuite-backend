const loggingService = require('../services/system/logging.service');

const createLoggingMiddleware = () => {
  return (req, res, next) => {
    const startTime = Date.now();

    // Capture request metadata
    req.log = {
      service: 'madsuite-backend',
      traceId: req.traceId || req.correlationId,
      userId: req.user?.id,
      organisationId: req.organisationId,
      action: `${req.method} ${req.path}`,
      resourceType: extractResourceType(req.path),
    };

    // Wrap res.send to capture response
    const originalSend = res.send;
    res.send = function (data) {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Determine log level based on status
      let level = 'INFO';
      if (statusCode >= 500) level = 'ERROR';
      else if (statusCode >= 400) level = 'WARN';

      // Log the request
      if (req.organisationId) {
        loggingService
          .recordLog({
            organisation_id: req.organisationId,
            timestamp: new Date(startTime),
            level,
            service: req.log.service,
            logger_name: 'http-request',
            message: `${req.method} ${req.path} - ${statusCode} (${duration}ms)`,
            trace_id: req.log.traceId,
            context: {
              http_method: req.method,
              http_path: req.path,
              http_status_code: statusCode,
              duration_ms: duration,
              user_id: req.user?.id,
              resource_type: req.log.resourceType,
            },
            stack_trace: statusCode >= 400 && data ? String(data) : null,
          })
          .catch((err) => {
            console.error('Failed to record log:', err.message);
          });
      }

      return originalSend.call(this, data);
    };

    next();
  };
};

// Helper function to extract resource type from path
const extractResourceType = (path) => {
  const parts = path.split('/').filter((p) => p);
  if (parts.length === 0) return 'root';

  // Extract from standard REST patterns
  if (parts[0] === 'api') {
    return parts[1] || 'unknown';
  }

  return parts[0] || 'unknown';
};

// Structured logging helper
const createLogger = (serviceName, organisationId) => {
  return {
    debug: (message, context = {}) =>
      loggingService.recordLog({
        organisation_id: organisationId,
        level: 'DEBUG',
        service: serviceName,
        logger_name: 'application',
        message,
        context,
      }),

    info: (message, context = {}) =>
      loggingService.recordLog({
        organisation_id: organisationId,
        level: 'INFO',
        service: serviceName,
        logger_name: 'application',
        message,
        context,
      }),

    warn: (message, context = {}) =>
      loggingService.recordLog({
        organisation_id: organisationId,
        level: 'WARN',
        service: serviceName,
        logger_name: 'application',
        message,
        context,
      }),

    error: (message, error, context = {}) => {
      const stackTrace = error instanceof Error ? error.stack : String(error);
      return loggingService.recordLog({
        organisation_id: organisationId,
        level: 'ERROR',
        service: serviceName,
        logger_name: 'application',
        message,
        stack_trace: stackTrace,
        context: {
          ...context,
          error_code: error?.code || 'UNKNOWN',
          error_message: error?.message || String(error),
        },
      });
    },

    fatal: (message, error, context = {}) => {
      const stackTrace = error instanceof Error ? error.stack : String(error);
      return loggingService.recordLog({
        organisation_id: organisationId,
        level: 'FATAL',
        service: serviceName,
        logger_name: 'application',
        message,
        stack_trace: stackTrace,
        context: {
          ...context,
          error_code: error?.code || 'UNKNOWN',
          error_message: error?.message || String(error),
        },
      });
    },
  };
};

module.exports = {
  createLoggingMiddleware,
  createLogger,
  loggingService,
};
