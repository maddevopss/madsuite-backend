'use strict';

/**
 * Core Execution Policy Engine
 * Evaluates system observability facts to produce deterministic execution decisions.
 */
class ExecutionPolicy {
  /**
   * Evaluates the execution allowed state based on current system health facts.
   * @param {string} status - The canonical system health status ('HEALTHY', 'DEGRADED_SAFE', 'DEGRADED_RISKY', 'UNHEALTHY').
   * @param {number} confidence - The system observability confidence score (0-100).
   * @param {object} flags - Additional execution flags or context.
   * @returns {object} The canonical execution decision.
   */
  evaluate(status, confidence, flags = {}) {
    let reason = 'SYSTEM_HEALTHY';
    
    if (status === 'UNHEALTHY') {
      reason = 'EXTERNAL_FINANCIAL_DRIFT_DETECTED';
    } else if (status === 'DEGRADED_RISKY') {
      reason = 'LEDGER_INCONSISTENCY_DETECTED';
    } else if (confidence < 50) {
      reason = 'SYSTEM_OBSERVABILITY_COLLAPSED';
    } else if (status === 'DEGRADED_SAFE') {
      reason = 'SAFE_DEGRADED_CONTINUITY';
    }

    const isHealthy = status === 'HEALTHY' || status === 'DEGRADED_SAFE';
    const hasConfidence = confidence >= 50;

    return {
      allowed: isHealthy && hasConfidence,
      reason: reason,
      confidence: confidence
    };
  }
}

module.exports = new ExecutionPolicy();
