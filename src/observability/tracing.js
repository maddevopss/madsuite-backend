const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { ConsoleSpanExporter, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { trace, context } = require('@opentelemetry/api');

let sdk;
let tracerProvider;

const initializeTracing = () => {
  // Only initialize once
  if (sdk) return sdk;

  const resource = Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'madsuite-backend',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION || '2.0.0',
      environment: process.env.NODE_ENV || 'development',
    }),
  );

  // Use console exporter in development, OTLP in production
  const exporter = process.env.NODE_ENV === 'production'
    ? new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      })
    : new ConsoleSpanExporter();

  sdk = new NodeSDK({
    resource,
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  tracerProvider = trace.getTracerProvider();

  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => {
        console.log('Tracing terminated');
      })
      .catch((err) => {
        console.error('Error terminating tracing', err);
      });
  });

  return sdk;
};

const getTracer = (name) => {
  if (!tracerProvider) {
    throw new Error('Tracing not initialized. Call initializeTracing() first.');
  }
  return tracerProvider.getTracer(name, '1.0.0');
};

const getTraceId = () => {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    return activeSpan.spanContext().traceId;
  }
  return null;
};

const getSpanContext = () => {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    return activeSpan.spanContext();
  }
  return null;
};

const withSpan = async (tracer, name, options, fn) => {
  const span = tracer.startSpan(name, options);
  try {
    return await context.with(trace.setSpan(context.active(), span), fn);
  } catch (err) {
    span.setStatus({ code: 2 }); // ERROR
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
};

module.exports = {
  initializeTracing,
  getTracer,
  getTraceId,
  getSpanContext,
  withSpan,
  trace,
  context,
};
