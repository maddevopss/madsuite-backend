'use strict';
const { AsyncLocalStorage } = require('async_hooks');

const executionContext = new AsyncLocalStorage();

class MissingExecutionContextError extends Error {
  constructor() {
    super('Missing AsyncLocalStorage Execution Context: System operation is not properly wrapped in runWithContext().');
    this.name = 'MissingExecutionContextError';
  }
}

function debugLog(msg, data) {
  if (process.env.DEBUG_CONTEXT === 'true') {
    console.log(`[ExecutionContext] ${msg}`, data ? JSON.stringify(data) : '');
  }
}

function runWithContext(context, callback) {
  if (typeof callback !== 'function') {
    throw new Error('ExecutionContext: callback must be a function');
  }

  // Prevent context leakage between concurrent jobs by creating an isolated clone
  const safeContext = { ...(context || {}) };

  // Ensure strict invariants mode is present, defaulting to env or STRICT fail-safe
  if (!safeContext.strict_mode_snapshot) {
    safeContext.strict_mode_snapshot = process.env.STRICT_INVARIANTS_MODE || 'strict';
  }

  // Ensure STRICT_INVARIANTS_MODE is immutable after initialization
  // Prevents mid-execution mutation (will throw in 'use strict' mode)
  Object.freeze(safeContext);

  debugLog('Starting execution with isolated context', { strict_mode: safeContext.strict_mode_snapshot });

  return executionContext.run(safeContext, callback);
}

const missingContextIncidents = {
  total: 0,
  byService: {},
  byJobType: {}
};

function trackMissingContextIncident() {
  missingContextIncidents.total++;
  try {
    const stack = new Error().stack;
    // Extract the first caller outside this file that matches src/services or src/jobs
    const match = stack.match(/(?:services|jobs)[\\/][^:]+\.js/);
    if (match) {
      const filePath = match[0].replace(/\\/g, '/'); // Normalize windows slashes
      if (filePath.startsWith('services/')) {
        const serviceName = filePath.split('/').pop().replace('.js', '');
        missingContextIncidents.byService[serviceName] = (missingContextIncidents.byService[serviceName] || 0) + 1;
      } else if (filePath.startsWith('jobs/')) {
        const jobName = filePath.split('/').pop().replace('.js', '');
        missingContextIncidents.byJobType[jobName] = (missingContextIncidents.byJobType[jobName] || 0) + 1;
      }
    }
  } catch (err) {
    // Silent fail for stack trace parsing
  }
}

function getContext() {
  const store = executionContext.getStore();
  
  if (!store) {
    if (process.env.NODE_ENV !== 'production') {
      // DEV/TEST: Fail loudly to prevent un-instrumented code from reaching production
      throw new MissingExecutionContextError();
    }
    
    // PROD: Degrade safely to prevent total system outage, but emit a critical warning
    // This allows metric alarms to catch the instrumentation leak without crashing the server.
    trackMissingContextIncident();
    console.warn('[CRITICAL_METRIC] MissingExecutionContextError: Operation executed without ALS context! Falling back to STRICT fail-safe to prevent data corruption. Fix instrumentation upstream.');
    
    return Object.freeze({ strict_mode_snapshot: 'strict', _fallback: true });
  }
  
  return store;
}

function getStrictMode() {
  // Ensure all downstream services always read context from ALS only
  const ctx = getContext();
  return ctx.strict_mode_snapshot;
}

function getMissingContextCount() {
  return missingContextIncidents;
}

module.exports = { runWithContext, getContext, getStrictMode, getMissingContextCount, MissingExecutionContextError };
