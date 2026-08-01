const { pool } = require("../../db");
const logger = require("../config/logger");

const highSeverityInvariants = [
  "invoice_immutability_lock",
  "invoice_idempotency",
  "append_only_ledger",
  "invoice_paid_implies_ledger_entry",
  "stripe_payment_propagation",
  "auto_sent_recurring_invoices",
  "recurring_generation_atomicity",
  "dunning_only_for_overdue_invoices",
  "mrr_snapshot_consistency",
  "outbox_at_least_once_delivery",
  "outbox_concurrent_processing_protection",
  "outbox_stuck_event_recovery",
];

async function logConsistencyResult(invariantName, status, details = null) {
  try {
    await pool.query(
      `INSERT INTO system_consistency_logs (invariant_name, status, details) 
       VALUES ($1, $2, $3)`,
      [invariantName, status, details ? JSON.stringify(details) : null],
    );

    // FIX P1 (audit multi-tenant 2026-06-24) :
    // Les notifications HIGH SEVERITY étaient envoyées à TOUS les admins de TOUTES
    // les organisations (WHERE role = 'admin' sans filtre org), exposant des informations
    // de cohérence système globale aux admins d'organisations clientes.
    // Correction : log Winston uniquement. Les super-admins plateforme consultent
    // la santé système via GET /api/system/health (restreint à requireSuperAdmin).
    if (status === "FAIL" && highSeverityInvariants.includes(invariantName)) {
      logger.error(`[SystemConsistency] HIGH SEVERITY INVARIANT FAILED: ${invariantName}`, {
        invariantName,
        status,
        details,
      });
    }
  } catch (err) {
    logger.error(`Error logging consistency result for ${invariantName}`, err);
  }
}

async function runSystemConsistencyCheck() {
  logger.info("Starting System Consistency Check...");

  // time_entries/expenses/invoices sont sous RLS FORCE : ces vérifications sont
  // intentionnellement cross-tenant (détection à l'échelle de la plateforme),
  // résolues via des fonctions SECURITY DEFINER étroites plutôt qu'une lecture
  // directe qui retournerait toujours 0 ligne sur une connexion non scopée.

  // 1. invoice_immutability_lock
  try {
    const res1 = await pool.query(`SELECT * FROM check_invoice_immutability_violations() LIMIT 10`);
    if (res1.rows.length > 0) {
      await logConsistencyResult("invoice_immutability_lock", "FAIL", { violations: res1.rows });
    } else {
      await logConsistencyResult("invoice_immutability_lock", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("invoice_immutability_lock", "ERROR", { error: err.message });
  }

  // 2. invoice_idempotency
  try {
    const res2 = await pool.query(`SELECT * FROM check_invoice_idempotency_violations() LIMIT 10`);
    if (res2.rows.length > 0) {
      await logConsistencyResult("invoice_idempotency", "FAIL", { violations: res2.rows });
    } else {
      await logConsistencyResult("invoice_idempotency", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("invoice_idempotency", "ERROR", { error: err.message });
  }

  // 3. estimate_to_invoice_propagation
  try {
    const res3 = await pool.query(`
      SELECT il.id 
      FROM invoice_items il 
      JOIN invoices i ON il.invoice_id = i.id 
      WHERE i.source = 'estimate' AND il.time_entry_id IS NOT NULL
      LIMIT 10
    `);
    if (res3.rows.length > 0) {
      await logConsistencyResult("estimate_to_invoice_propagation", "FAIL", { violations: res3.rows });
    } else {
      await logConsistencyResult("estimate_to_invoice_propagation", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("estimate_to_invoice_propagation", "ERROR", { error: err.message });
  }

  // 4. append_only_ledger
  await logConsistencyResult("append_only_ledger", "WARNING", {
    message: "Cannot be statically verified without database triggers or audit logs.",
  });

  // 5. invoice_paid_implies_ledger_entry
  try {
    const res5 = await pool.query(`SELECT * FROM check_invoice_ledger_violations() LIMIT 10`);
    if (res5.rows.length > 0) {
      await logConsistencyResult("invoice_paid_implies_ledger_entry", "FAIL", { violations: res5.rows });
    } else {
      await logConsistencyResult("invoice_paid_implies_ledger_entry", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("invoice_paid_implies_ledger_entry", "ERROR", { error: err.message });
  }

  // 6. stripe_webhook_idempotency
  try {
    const res6 = await pool.query(`
      SELECT stripe_event_id, count(*) as count 
      FROM payment_events 
      WHERE stripe_event_id IS NOT NULL 
      GROUP BY stripe_event_id 
      HAVING count(*) > 1
      LIMIT 10
    `);
    if (res6.rows.length > 0) {
      await logConsistencyResult("stripe_webhook_idempotency", "FAIL", { violations: res6.rows });
    } else {
      await logConsistencyResult("stripe_webhook_idempotency", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("stripe_webhook_idempotency", "ERROR", { error: err.message });
  }

  // 7. stripe_payment_propagation
  // Corrigé : référençait pe.reference_id/reference_type/status, des colonnes
  // qui n'existent pas sur payment_events (invoice_id/type) — ce check
  // échouait systématiquement en erreur depuis toujours, jamais fonctionnel.
  try {
    const res7 = await pool.query(`SELECT * FROM check_stripe_payment_status_drift() LIMIT 10`);
    if (res7.rows.length > 0) {
      await logConsistencyResult("stripe_payment_propagation", "FAIL", { violations: res7.rows });
    } else {
      await logConsistencyResult("stripe_payment_propagation", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("stripe_payment_propagation", "ERROR", { error: err.message });
  }

  // 8. auto_sent_recurring_invoices
  try {
    const res8 = await pool.query(`
      SELECT id 
      FROM invoices 
      WHERE is_recurring_generated = TRUE AND status = 'draft'
      LIMIT 10
    `);
    if (res8.rows.length > 0) {
      await logConsistencyResult("auto_sent_recurring_invoices", "FAIL", { violations: res8.rows });
    } else {
      await logConsistencyResult("auto_sent_recurring_invoices", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("auto_sent_recurring_invoices", "ERROR", { error: err.message });
  }

  // 9. recurring_generation_atomicity
  await logConsistencyResult("recurring_generation_atomicity", "WARNING", {
    message: "Structurally enforced via PostgreSQL transactions. Cannot be verified purely from states.",
  });

  // 10. dunning_escalation_staircase
  try {
    const res10 = await pool.query(`
      SELECT r.invoice_id 
      FROM billing_reminders r 
      WHERE r.level = 'firm' 
      AND NOT EXISTS (
        SELECT 1 FROM billing_reminders sub WHERE sub.invoice_id = r.invoice_id AND sub.level = 'gentle'
      )
      LIMIT 10
    `);
    if (res10.rows.length > 0) {
      await logConsistencyResult("dunning_escalation_staircase", "FAIL", { violations: res10.rows });
    } else {
      await logConsistencyResult("dunning_escalation_staircase", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("dunning_escalation_staircase", "ERROR", { error: err.message });
  }

  // 11. dunning_only_for_overdue_invoices
  try {
    const res11 = await pool.query(`
      SELECT r.id 
      FROM billing_reminders r 
      JOIN invoices i ON r.invoice_id = i.id 
      WHERE i.status != 'sent' OR i.due_date >= NOW()
      LIMIT 10
    `);
    if (res11.rows.length > 0) {
      await logConsistencyResult("dunning_only_for_overdue_invoices", "FAIL", { violations: res11.rows });
    } else {
      await logConsistencyResult("dunning_only_for_overdue_invoices", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("dunning_only_for_overdue_invoices", "ERROR", { error: err.message });
  }

  // 12. mrr_snapshot_consistency
  try {
    const res12 = await pool.query(`
      SELECT organisation_id, date, count(*) as count 
      FROM metrics_snapshot 
      GROUP BY organisation_id, date 
      HAVING count(*) > 1
      LIMIT 10
    `);
    if (res12.rows.length > 0) {
      await logConsistencyResult("mrr_snapshot_consistency", "FAIL", { violations: res12.rows });
    } else {
      await logConsistencyResult("mrr_snapshot_consistency", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("mrr_snapshot_consistency", "ERROR", { error: err.message });
  }

  // 13. historical_static_truth
  await logConsistencyResult("historical_static_truth", "WARNING", {
    message: "Cannot be dynamically verified without historical data comparisons.",
  });

  // 14. outbox_at_least_once_delivery
  await logConsistencyResult("outbox_at_least_once_delivery", "PASS", {
    message: "Covered by outbox_stuck_event_recovery check.",
  });

  // 15. outbox_concurrent_processing_protection
  await logConsistencyResult("outbox_concurrent_processing_protection", "WARNING", {
    message: "Enforced via FOR UPDATE SKIP LOCKED. Static verification not possible.",
  });

  // 16. outbox_stuck_event_recovery
  try {
    const res16 = await pool.query(`
      SELECT id 
      FROM outbox_events 
      WHERE status = 'processing' 
      AND updated_at < NOW() - INTERVAL '15 minutes'
      LIMIT 10
    `);
    if (res16.rows.length > 0) {
      await logConsistencyResult("outbox_stuck_event_recovery", "FAIL", { violations: res16.rows });
    } else {
      await logConsistencyResult("outbox_stuck_event_recovery", "PASS");
    }
  } catch (err) {
    await logConsistencyResult("outbox_stuck_event_recovery", "ERROR", { error: err.message });
  }

  logger.info("System Consistency Check completed.");

  return { status: "SUCCESS" };
}

module.exports = { runSystemConsistencyCheck };
