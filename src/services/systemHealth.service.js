const { pool } = require("../../db");
let scoreDeprecationWarned = false;

/**
 * Calculates the system health score based on the latest consistency check.
 * Evaluates risk across multiple pillars using a calibrated 4-tier model.
 * 
 * ============================================================================
 * GLOBAL EXECUTION RULE:
 * There must be exactly ONE source of truth for execution decisions:
 * -> `execution_decision.allowed`
 * 
 * Everything else (status, score, confidence, anomalies) is strictly informative 
 * and MUST ONLY be used for observability, diagnostics, and audit tracking.
 * ============================================================================
 * 
 * Classifications:
 * - UNHEALTHY: Critical external financial drift (Stripe mismatches)
 * - DEGRADED_RISKY: Ledger internal inconsistency
 * - DEGRADED_SAFE: Internal subsystem logs or query failures
 * - HEALTHY: Full operational integrity
 */
async function calculateSystemHealthScore() {
  const latestRunRes = await pool.query(`
    SELECT MAX(detected_at) as latest 
    FROM system_consistency_logs
  `);
  
  let logFails = [];
  if (latestRunRes.rows[0].latest) {
    const latest = latestRunRes.rows[0].latest;
    const logsRes = await pool.query(`
      SELECT invariant_name, status, details 
      FROM system_consistency_logs 
      WHERE detected_at >= $1::timestamp - interval '5 minutes'
    `, [latest]);
    logFails = logsRes.rows.filter(l => l.status === 'FAIL');
  }

  const highSeverityInvariants = [
    'invoice_immutability_lock',
    'invoice_idempotency',
    'append_only_ledger',
    'invoice_paid_implies_ledger_entry',
    'stripe_payment_propagation',
    'auto_sent_recurring_invoices',
    'recurring_generation_atomicity',
    'dunning_only_for_overdue_invoices',
    'mrr_snapshot_consistency',
    'outbox_at_least_once_delivery',
    'outbox_concurrent_processing_protection',
    'outbox_stuck_event_recovery'
  ];

  let ledgerViolations = 0;
  let ledgerQueryFailed = false;
  try {
    const sampleRes = await pool.query(`
      SELECT COUNT(*) as violations 
      FROM invoices i 
      LEFT JOIN ledger_entries le ON le.reference_id = i.id::text AND le.reference_type = 'invoice' 
      WHERE i.status = 'paid' AND le.id IS NULL
    `);
    ledgerViolations = parseInt(sampleRes.rows[0].violations, 10);
  } catch (err) {
    ledgerQueryFailed = true;
  }

  let stripeViolations = 0;
  let stripeQueryFailed = false;
  try {
    const externalRes = await pool.query(`
      SELECT COUNT(*) as violations
      FROM payment_events pe
      JOIN invoices i ON i.id = pe.invoice_id
      WHERE pe.type IN ('payment_intent.succeeded', 'charge.succeeded', 'invoice.payment_succeeded')
      AND i.status != 'paid'
    `);
    stripeViolations = parseInt(externalRes.rows[0].violations, 10);
  } catch(err) {
    stripeQueryFailed = true;
  }

  let highSeverityFailsCount = 0;
  let lowSeverityFailsCount = 0;

  for (const f of logFails) {
    if (highSeverityInvariants.includes(f.invariant_name)) {
      highSeverityFailsCount++;
    } else {
      lowSeverityFailsCount++;
    }
  }

  // Risk Tolerance Calibration Layer
  // Ensure deterministic evaluation where internal logs cannot hard-fail the system state.
  let status = 'HEALTHY';
  let confidence = 100;

  // 1. Stripe mismatch (External financial drift) is the ONLY trigger for UNHEALTHY
  if (stripeViolations > 0) {
    status = 'UNHEALTHY';
    confidence -= 50;
  } 
  // 2. Ledger inconsistency triggers DEGRADED_RISKY
  else if (ledgerViolations > 0) {
    status = 'DEGRADED_RISKY';
    confidence -= 20;
  } 
  // 3. Internal logs or query availability issues trigger DEGRADED_SAFE
  else if (highSeverityFailsCount > 0 || lowSeverityFailsCount > 0 || stripeQueryFailed || ledgerQueryFailed) {
    status = 'DEGRADED_SAFE';
  }

  // Internal systems degrade confidence, never system state
  if (highSeverityFailsCount > 0) {
    confidence -= (highSeverityFailsCount * 10);
  }
  if (lowSeverityFailsCount > 0) {
    confidence -= (lowSeverityFailsCount * 2);
  }
  if (ledgerQueryFailed || stripeQueryFailed) {
    confidence -= 30;
  }

  confidence = Math.max(0, confidence);

  // Backward compatibility: Map status bounds to a numeric score to prevent false cascading failures
  // DEPRECATED COMPATIBILITY LAYER: score is preserved solely for legacy API consumers.
  let scoreValue = 100;
  if (status === 'UNHEALTHY') {
    scoreValue = 0;
  } else if (status === 'DEGRADED_RISKY') {
    // Floor at 30 to prevent legacy hard-fails
    scoreValue = Math.max(30, 100 - (ledgerViolations * 20) - (highSeverityFailsCount * 10));
  } else if (status === 'DEGRADED_SAFE') {
    // Floor at 70 to assure safe operational continuity
    scoreValue = Math.max(70, 100 - (highSeverityFailsCount * 10) - (lowSeverityFailsCount * 2));
  }

  const trendsRes = await pool.query(`
    SELECT DATE(detected_at) as date, COUNT(*) as fails_count
    FROM system_consistency_logs
    WHERE status = 'FAIL' AND detected_at >= NOW() - interval '7 days'
    GROUP BY DATE(detected_at)
    ORDER BY date ASC
  `);

  const executionPolicy = require('../core/executionPolicy');

  // Delegation of the execution policy to a dedicated engine
  const execution_decision = executionPolicy.evaluate(status, confidence, {
    ledgerViolations,
    stripeViolations,
    highSeverityFailsCount,
    lowSeverityFailsCount
  });

  const { getMissingContextCount } = require('../core/executionContext');

const result = {
  status,
  execution_decision,
  missing_context_incidents: getMissingContextCount(),
  fails: logFails.map(f => ({ name: f.invariant_name, details: f.details })),
  trends: trendsRes.rows,
  score: scoreValue // 👈 IMPORTANT
};

  // Inject score via getter to alert developers migrating the codebase
  Object.defineProperty(result, 'score', {
    get() {
      if (!scoreDeprecationWarned) {
        console.warn('[DEPRECATION_WARNING] Accessing legacy systemHealth.score. This numeric mapping is deprecated. You MUST use the canonical `execution_decision` object for execution decisions. This warning will only be shown once.');
        scoreDeprecationWarned = true;
      }
      return scoreValue;
    },
    enumerable: true // Keep it serializable for backward compatibility with older API clients
  });

  return result;
}

module.exports = { calculateSystemHealthScore };
