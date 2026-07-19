const { pool } = require("../../db");
const logger = require("../config/logger");
const { createJobResultTracker } = require("./jobResultAggregator");
const crypto = require("crypto");

/**
 * System Reconciliation Engine (Audit Oracle)
 * STRICTLY READ-ONLY: this job reports facts and never repairs financial state.
 */
async function runSystemReconciliation() {
  const tracker = createJobResultTracker("System Reconciliation");
  logger.info("Running Global System Reconciliation (Forensic Mode)...");

  try {
    const anomalies = [];

    // 1. Paid invoice total vs Stripe-backed ledger total.
    // Payments created by Stripe reconciliation are linked through:
    // invoice -> payment_events.invoice_id -> ledger_entries.reference_id = stripe_event_id.
    const ledgerImbalanceRes = await pool.query(`
      WITH paid_ledger AS (
        SELECT
          pe.invoice_id,
          COALESCE(SUM(le.amount), 0) AS ledger_total
        FROM payment_events pe
        JOIN ledger_entries le
          ON le.reference_id = pe.stripe_event_id
         AND le.reference_type = 'stripe_webhook'
         AND le.type = 'payment_received'
        WHERE pe.type IN (
          'payment_intent.succeeded',
          'charge.succeeded',
          'invoice.payment_succeeded'
        )
        GROUP BY pe.invoice_id
      )
      SELECT
        i.id AS invoice_id,
        i.organisation_id,
        i.total AS invoice_total,
        pl.ledger_total
      FROM invoices i
      JOIN paid_ledger pl ON pl.invoice_id = i.id
      WHERE i.status = 'paid'
        AND ROUND(i.total::numeric, 2) != ROUND(pl.ledger_total::numeric, 2)
    `);

    for (const row of ledgerImbalanceRes.rows) {
      anomalies.push({
        classification: "LEDGER_IMBALANCE",
        reference_id: row.invoice_id,
        organisation_id: row.organisation_id,
        expected: row.invoice_total,
        actual: row.ledger_total,
        description: "Paid invoice total does not match Stripe-backed payment ledger entries.",
      });
    }

    // 2. Stripe event amount vs its exact ledger entry.
    const webhookMismatchRes = await pool.query(`
      SELECT
        pe.invoice_id,
        pe.stripe_event_id,
        i.organisation_id,
        CASE
          WHEN pe.type = 'invoice.payment_succeeded'
            THEN (pe.payload->'data'->'object'->>'amount_paid')::numeric / 100
          ELSE (pe.payload->'data'->'object'->>'amount')::numeric / 100
        END AS stripe_total,
        SUM(le.amount) AS ledger_total
      FROM payment_events pe
      JOIN invoices i ON i.id = pe.invoice_id
      JOIN ledger_entries le
        ON le.reference_id = pe.stripe_event_id
       AND le.reference_type = 'stripe_webhook'
       AND le.type = 'payment_received'
      WHERE pe.type IN (
        'payment_intent.succeeded',
        'charge.succeeded',
        'invoice.payment_succeeded'
      )
      GROUP BY pe.invoice_id, pe.stripe_event_id, i.organisation_id, pe.type, pe.payload
      HAVING ROUND((CASE
        WHEN pe.type = 'invoice.payment_succeeded'
          THEN (pe.payload->'data'->'object'->>'amount_paid')::numeric / 100
        ELSE (pe.payload->'data'->'object'->>'amount')::numeric / 100
      END), 2) != ROUND(SUM(le.amount)::numeric, 2)
    `);

    for (const row of webhookMismatchRes.rows) {
      anomalies.push({
        classification: "WEBHOOK_MISMATCH",
        reference_id: row.invoice_id,
        event_id: row.stripe_event_id,
        organisation_id: row.organisation_id,
        expected: row.stripe_total,
        actual: row.ledger_total,
        description: "Stripe payment amount does not match its corresponding ledger entry.",
      });
    }

    // 3. Invoice marked paid but no successful Stripe event with a ledger effect.
    const dataDriftRes = await pool.query(`
      SELECT i.id AS invoice_id, i.organisation_id, i.status
      FROM invoices i
      WHERE i.status = 'paid'
        AND NOT EXISTS (
          SELECT 1
          FROM payment_events pe
          JOIN ledger_entries le
            ON le.reference_id = pe.stripe_event_id
           AND le.reference_type = 'stripe_webhook'
           AND le.type = 'payment_received'
          WHERE pe.invoice_id = i.id
            AND pe.type IN (
              'payment_intent.succeeded',
              'charge.succeeded',
              'invoice.payment_succeeded'
            )
        )
    `);

    for (const row of dataDriftRes.rows) {
      anomalies.push({
        classification: "DATA_DRIFT",
        reference_id: row.invoice_id,
        organisation_id: row.organisation_id,
        expected: "successful_payment_with_ledger",
        actual: "missing_payment_or_ledger",
        description: "Invoice is paid but lacks a successful Stripe event backed by a ledger entry.",
      });
    }

    // 4. Successful payment exists while invoice is still not paid.
    const paymentStateDriftRes = await pool.query(`
      SELECT DISTINCT
        i.id AS invoice_id,
        i.organisation_id,
        i.status,
        pe.stripe_event_id
      FROM invoices i
      JOIN payment_events pe ON pe.invoice_id = i.id
      JOIN ledger_entries le
        ON le.reference_id = pe.stripe_event_id
       AND le.reference_type = 'stripe_webhook'
       AND le.type = 'payment_received'
      WHERE i.status != 'paid'
        AND pe.type IN (
          'payment_intent.succeeded',
          'charge.succeeded',
          'invoice.payment_succeeded'
        )
    `);

    for (const row of paymentStateDriftRes.rows) {
      anomalies.push({
        classification: "PAYMENT_STATE_DRIFT",
        reference_id: row.invoice_id,
        event_id: row.stripe_event_id,
        organisation_id: row.organisation_id,
        expected: "paid",
        actual: row.status,
        description: "A successful Stripe-backed ledger payment exists but the invoice is not paid.",
      });
    }

    // 5. Subscription analytics consistency.
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
        (SELECT COUNT(*) FROM analytics_subs) AS analytics_count,
        (SELECT COUNT(*) FROM db_pro) AS db_count,
        (SELECT COUNT(*) FROM analytics_subs a
          LEFT JOIN db_pro d ON a.organisation_id = d.id
          WHERE d.id IS NULL) AS analytics_without_db,
        (SELECT COUNT(*) FROM db_pro d
          LEFT JOIN analytics_subs a ON d.id = a.organisation_id
          WHERE a.organisation_id IS NULL) AS db_without_analytics
    `);

    const subRow = subTruthRes.rows[0];
    if (
      Number(subRow.analytics_count) !== Number(subRow.db_count) ||
      Number(subRow.analytics_without_db) > 0 ||
      Number(subRow.db_without_analytics) > 0
    ) {
      anomalies.push({
        classification: "REVENUE_SUBSCRIPTION_TRUTH_DRIFT",
        reference_id: "subscription_active",
        expected: subRow.db_count,
        actual: subRow.analytics_count,
        description: `subscription_active events do not match active/pro organisations. Orphans: analytics=${subRow.analytics_without_db}, db=${subRow.db_without_analytics}`,
      });
    }

    // 6. First-invoice analytics consistency.
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
        (SELECT COUNT(*) FROM analytics_first) AS analytics_count,
        (SELECT COUNT(*) FROM actual_invoices) AS db_count,
        (SELECT COUNT(*) FROM analytics_first a
          LEFT JOIN actual_invoices d ON a.organisation_id = d.organisation_id
          WHERE d.organisation_id IS NULL) AS analytics_without_db
    `);

    const invRow = invoiceTruthRes.rows[0];
    if (
      Number(invRow.analytics_count) > Number(invRow.db_count) ||
      Number(invRow.analytics_without_db) > 0
    ) {
      anomalies.push({
        classification: "REVENUE_FIRST_INVOICE_TRUTH_DRIFT",
        reference_id: "first_invoice_created",
        expected: invRow.db_count,
        actual: invRow.analytics_count,
        description: `first_invoice_created events exceed or do not align with organisations having invoices. Orphans=${invRow.analytics_without_db}`,
      });
    }

    const reportId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const score = anomalies.length === 0 ? 100 : Math.max(0, 100 - anomalies.length * 10);
    const systemIntegrityReport = {
      report_id: reportId,
      timestamp,
      version: "1.2.0",
      engine_type: "audit_oracle",
      score,
      total_anomalies: anomalies.length,
      anomalies,
    };

    await pool.query(
      `
      INSERT INTO system_consistency_logs (invariant_name, status, details)
      VALUES ('system_integrity_report', $1, $2)
      `,
      [score === 100 ? "PASS" : "FAIL", JSON.stringify(systemIntegrityReport)],
    );

    if (anomalies.length > 0) {
      await tracker.recordFailure(
        new Error(`System Integrity Report detected ${anomalies.length} anomalies`),
        { reportId },
        "MEDIUM",
      );
    } else {
      tracker.recordSuccess();
    }

    return {
      status: tracker.resolveStatus(),
      report: systemIntegrityReport,
      alert_candidates: anomalies,
    };
  } catch (error) {
    logger.error("Error in System Reconciliation", error);
    await tracker.recordFailure(error, {}, "CRITICAL");
    throw error;
  }
}

module.exports = { runSystemReconciliation };
