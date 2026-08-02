const { trace, context } = require('@opentelemetry/api');
const { getTracer, getTraceId } = require('./tracing');

// Standard trace header names (W3C Trace Context + B3)
const TRACE_ID_HEADER = 'traceparent';
const B3_TRACE_ID_HEADER = 'x-b3-traceid';
const B3_SPAN_ID_HEADER = 'x-b3-spanid';
const CORRELATION_ID_HEADER = 'x-correlation-id';

const tracer = getTracer('madsuite-middleware');

const createTraceMiddleware = (tracingService) => {
  return (req, res, next) => {
    const startTime = Date.now();

    // Extract or create trace ID from headers
    let traceId = req.get(TRACE_ID_HEADER)
      || req.get(B3_TRACE_ID_HEADER)
      || req.get(CORRELATION_ID_HEADER);

    // If no trace ID, generate one (UUID format)
    if (!traceId) {
      const crypto = require('crypto');
      traceId = crypto.randomUUID();
    }

    // Store trace ID in request for use by downstream code
    req.traceId = traceId;
    req.correlationId = traceId;

    // Add trace ID to response headers
    res.setHeader(CORRELATION_ID_HEADER, traceId);
    res.setHeader('x-trace-id', traceId);

    // Create root span for this request
    const span = tracer.startSpan(`${req.method} ${req.path}`, {
      attributes: {
        'http.method': req.method,
        'http.url': `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        'http.target': req.path,
        'http.host': req.get('host'),
        'http.scheme': req.protocol,
        'http.user_agent': req.get('user-agent'),
        'trace.correlation_id': traceId,
      },
    });

    // Wrap response methods to capture status and save trace
    const originalSend = res.send;
    res.send = function (data) {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Record HTTP response details
      span.setAttributes({
        'http.status_code': statusCode,
        'http.response_time_ms': duration,
        'http.status': statusCode >= 400 ? 'error' : 'success',
      });

      // Set span status
      if (statusCode >= 500) {
        span.setStatus({ code: 2 }); // ERROR
      } else if (statusCode >= 400) {
        span.setStatus({ code: 1 }); // UNSET/WARNING
      } else {
        span.setStatus({ code: 0 }); // OK
      }

      // Save trace to database if service provided
      if (tracingService && req.organisationId) {
        tracingService
          .recordTrace({
            organisation_id: req.organisationId,
            trace_id: traceId,
            service_name: 'madsuite-backend',
            operation_name: `${req.method} ${req.path}`,
            status: statusCode >= 400 ? 'error' : 'success',
            start_time: new Date(startTime),
            duration_ms: duration,
            error_message: statusCode >= 400 ? `HTTP ${statusCode}` : null,
            tags: {
              http_method: req.method,
              http_status_code: statusCode,
              http_path: req.path,
              user_id: req.user?.id || null,
              organisation_id: req.organisationId,
            },
          })
          .catch((err) => {
            console.error('Failed to record trace:', err.message);
          });
      }

      // End span and call original send
      span.end();
      return originalSend.call(this, data);
    };

    // Run downstream handlers in trace context
    context.with(trace.setSpan(context.active(), span), () => {
      next();
    });
  };
};

// Helper to inject trace ID into outgoing requests (e.g., axios)
const injectTraceContext = (headers = {}) => {
  const traceId = getTraceId();
  if (traceId) {
    headers['x-trace-id'] = traceId;
    headers[CORRELATION_ID_HEADER] = traceId;
  }
  return headers;
};

module.exports = {
  createTraceMiddleware,
  injectTraceContext,
  TRACE_ID_HEADER,
  B3_TRACE_ID_HEADER,
  CORRELATION_ID_HEADER,
};
