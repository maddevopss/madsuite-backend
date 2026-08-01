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

    // invoices/analytics_events sont sous RLS FORCE : ce moteur scanne
    // intentionnellement toutes les organisations (audit financier
    // plateforme), résolu via des fonctions SECURITY DEFINER étroites
    // (mêmes requêtes) plutôt qu'une lecture directe sur une connexion non
    // scopée, qui retournerait toujours 0 ligne — masquant silencieusement
    // toute dérive Stripe/ledger réelle.

    // 1. Paid invoice total vs Stripe-backed ledger total.
    // Payments created by Stripe reconciliation are linked through:
    // invoice -> payment_events.invoice_id -> ledger_entries.reference_id = stripe_event_id.
    const ledgerImbalanceRes = await pool.query(`SELECT * FROM reconcile_ledger_imbalance()`);

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
    const webhookMismatchRes = await pool.query(`SELECT * FROM reconcile_webhook_mismatch()`);

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
    const dataDriftRes = await pool.query(`SELECT * FROM reconcile_data_drift()`);

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
    const paymentStateDriftRes = await pool.query(`SELECT * FROM reconcile_payment_state_drift()`);

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
    const subTruthRes = await pool.query(`SELECT * FROM reconcile_subscription_truth()`);

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
    const invoiceTruthRes = await pool.query(`SELECT * FROM reconcile_first_invoice_truth()`);

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
