const { pool } = require("../../db");
const logger = require("../config/logger");
const { createJobResultTracker } = require("./jobResultAggregator");
const crypto = require("crypto");

/**
 * System Reconciliation Engine (Audit Oracle)
 * STRICTLY READ-ONLY: This job operates in forensic mode.
 * It must never modify ledger, invoices, or application state.
 * Any anomalies detected are reported via system_integrity_report for external triage.
 * 
 * ARCHITECTURAL RULE:
 * 1. Reconciliation job produces FACTS ONLY.
 * 2. Escalation policy MUST be externalized to a policy engine (or the caller).
 * We do not embed decision or escalation logic inside the job or scheduler.
 */
async function runSystemReconciliation() {
  const tracker = createJobResultTracker('System Reconciliation');
  logger.info("Running Global System Reconciliation (Forensic Mode)...");
  
  try {
    const anomalies = [];

    // 1. LEDGER_IMBALANCE: Invoice vs Ledger totals
    const ledgerImbalanceRes = await pool.query(`
      SELECT i.id as invoice_id, i.total as invoice_total, SUM(le.amount) as ledger_total
      FROM invoices i
      JOIN ledger_entries le ON le.reference_id = i.id::text AND le.reference_type = 'invoice'
      WHERE i.status = 'paid'
      GROUP BY i.id, i.total
      HAVING i.total != SUM(le.amount)
    `);
    
    for (const row of ledgerImbalanceRes.rows) {
      anomalies.push({
        classification: 'LEDGER_IMBALANCE',
        reference_id: row.invoice_id,
        expected: row.invoice_total,
        actual: row.ledger_total,
        description: 'Invoice total does not match the sum of corresponding ledger entries.'
      });
    }

    // 2. WEBHOOK_MISMATCH: Ledger vs Stripe webhook payment events
    const webhookMismatchRes = await pool.query(`
      SELECT pe.invoice_id, SUM((pe.payload->'data'->'object'->>'amount')::numeric / 100) as stripe_total, SUM(le.amount) as ledger_total
      FROM payment_events pe
      JOIN ledger_entries le ON le.reference_id = pe.stripe_event_id AND le.reference_type = 'stripe_webhook'
      WHERE pe.type IN ('payment_intent.succeeded', 'charge.succeeded')
      GROUP BY pe.invoice_id
      HAVING SUM((pe.payload->'data'->'object'->>'amount')::numeric / 100) != SUM(le.amount)
    `);

    for (const row of webhookMismatchRes.rows) {
      anomalies.push({
        classification: 'WEBHOOK_MISMATCH',
        reference_id: row.invoice_id,
        expected: row.stripe_total,
        actual: row.ledger_total,
        description: 'Stripe webhook payment total does not match ledger entries recorded for that webhook.'
      });
    }

    // 3. DATA_DRIFT: Invoices marked paid but completely lacking ledger entries
    const dataDriftRes = await pool.query(`
      SELECT i.id as invoice_id, i.status
      FROM invoices i
      WHERE i.status = 'paid' AND NOT EXISTS (
        SELECT 1 FROM ledger_entries le 
        WHERE le.reference_id = i.id::text AND le.reference_type = 'invoice'
      )
    `);

    for (const row of dataDriftRes.rows) {
      anomalies.push({
        classification: 'DATA_DRIFT',
        reference_id: row.invoice_id,
        expected: 'has_ledger_entry',
        actual: 'no_ledger_entry',
        description: 'Invoice is marked as paid but has no corresponding ledger entries (drifted state).'
      });
    }

    // Prepare versioned, timestamped audit report
    const reportId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const reportVersion = "1.0.0";
    const score = anomalies.length === 0 ? 100 : Math.max(0, 100 - (anomalies.length * 10));

    const systemIntegrityReport = {
      report_id: reportId,
      timestamp,
      version: reportVersion,
      engine_type: 'audit_oracle', // Explicit separation from real-time enforcement engine
      score,
      total_anomalies: anomalies.length,
      anomalies
    };

    // Output is strictly a system_integrity_report to logs. No state mutations.
    await pool.query(`
      INSERT INTO system_consistency_logs (invariant_name, status, details)
      VALUES ('system_integrity_report', $1, $2)
    `, [score === 100 ? 'PASS' : 'FAIL', JSON.stringify(systemIntegrityReport)]);

    if (anomalies.length > 0) {
      // Use 'MEDIUM' severity to strictly limit this to an audit dashboard notification.
      // This prevents indirect side-effect pipelines (like outbox_events retries).
      // The upstream caller must explicitly decide what to do with 'alert_candidates'.
      await tracker.recordFailure(new Error(`System Integrity Report detected ${anomalies.length} anomalies`), { reportId }, 'MEDIUM');
    } else {
      tracker.recordSuccess();
    }
    
    return { 
      status: tracker.resolveStatus(), 
      report: systemIntegrityReport,
      alert_candidates: anomalies 
    };
  } catch(error) {
    logger.error("Error in System Reconciliation", error);
    await tracker.recordFailure(error, {}, 'CRITICAL');
    throw error;
  }
}

module.exports = { runSystemReconciliation };
