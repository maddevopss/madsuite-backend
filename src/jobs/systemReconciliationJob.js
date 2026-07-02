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

    // 4. REVENUE_TRUTH - Subscription consistency (analytics vs DB state)
    // This verifies that subscription_active events align with actual plan_type
    const subTruthRes = await pool.query(`
      WITH analytics_subs AS (
        SELECT DISTINCT organisation_id 
        FROM analytics_events 
        WHERE event_name = 'subscription_active'
          AND created_at >= NOW() - INTERVAL '90 days'
      ),
      db_pro AS (
        SELECT id FROM organisations 
        WHERE plan_type = 'pro' OR subscription_status = 'active'
      )
      SELECT 
        (SELECT COUNT(*) FROM analytics_subs) as analytics_count,
        (SELECT COUNT(*) FROM db_pro) as db_count,
        (SELECT COUNT(*) FROM analytics_subs a 
         LEFT JOIN db_pro d ON a.organisation_id = d.id 
         WHERE d.id IS NULL) as analytics_without_db,
        (SELECT COUNT(*) FROM db_pro d 
         LEFT JOIN analytics_subs a ON d.id = a.organisation_id 
         WHERE a.organisation_id IS NULL) as db_without_analytics
    `);

    const subRow = subTruthRes.rows[0];
    if (subRow.analytics_count !== subRow.db_count || subRow.analytics_without_db > 0 || subRow.db_without_analytics > 0) {
      anomalies.push({
        classification: 'REVENUE_SUBSCRIPTION_TRUTH_DRIFT',
        reference_id: 'subscription_active',
        expected: subRow.db_count,
        actual: subRow.analytics_count,
        description: `subscription_active events (${subRow.analytics_count}) do not match organisations with plan_type=pro or active subscription (${subRow.db_count}). Orphans: analytics=${subRow.analytics_without_db}, db=${subRow.db_without_analytics}`
      });
    }

    // 5. REVENUE_TRUTH - First invoice events vs actual invoices
    const invoiceTruthRes = await pool.query(`
      WITH analytics_first AS (
        SELECT DISTINCT organisation_id 
        FROM analytics_events 
        WHERE event_name = 'first_invoice_created'
          AND created_at >= NOW() - INTERVAL '90 days'
      ),
      actual_invoices AS (
        SELECT DISTINCT organisation_id FROM invoices
      )
      SELECT 
        (SELECT COUNT(*) FROM analytics_first) as analytics_count,
        (SELECT COUNT(*) FROM actual_invoices) as db_count,
        (SELECT COUNT(*) FROM analytics_first a 
         LEFT JOIN actual_invoices d ON a.organisation_id = d.organisation_id 
         WHERE d.organisation_id IS NULL) as analytics_without_db
    `);

    const invRow = invoiceTruthRes.rows[0];
    if (invRow.analytics_count > invRow.db_count || invRow.analytics_without_db > 0) {
      anomalies.push({
        classification: 'REVENUE_FIRST_INVOICE_TRUTH_DRIFT',
        reference_id: 'first_invoice_created',
        expected: invRow.db_count,
        actual: invRow.analytics_count,
        description: `first_invoice_created events (${invRow.analytics_count}) exceed or do not align with distinct organisations that actually have invoices (${invRow.db_count}). Orphans in analytics: ${invRow.analytics_without_db}`
      });
    }

    // Prepare versioned, timestamped audit report
    const reportId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const reportVersion = "1.1.0"; // Added Revenue Truth checks (subscription_active vs plan_type, first_invoice_created vs actual invoices)
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
