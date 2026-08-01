const db = require("../../db");
const paymentReminderService = require("./payment-reminder.service");

// payment_reminder_attempts est sous RLS FORCE : ces mises à jour sont
// appelées depuis outboxWorker.js (job cron, hors contexte requête), donc
// sans organisationId explicite le GUC ne serait jamais défini et l'UPDATE
// n'affecterait silencieusement aucune ligne.
async function markAttemptSent(attemptId, organisationId) {
  if (!attemptId || !organisationId) return null;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationId)]);
    const result = await client.query(
      `UPDATE payment_reminder_attempts
       SET status = 'sent', sent_at = NOW(), error_code = NULL,
           error_message = NULL, updated_at = NOW()
       WHERE id = $1 AND organisation_id = $2
       RETURNING id, organisation_id, invoice_id, stage, status, sent_at`,
      [attemptId, organisationId],
    );
    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function markAttemptFailed(attemptId, error, organisationId) {
  if (!attemptId || !organisationId) return null;
  const message = String(error?.message || error || "Échec d’envoi").slice(0, 1000);
  const code = String(error?.code || "DELIVERY_FAILED").slice(0, 100);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationId)]);
    const result = await client.query(
      `UPDATE payment_reminder_attempts
       SET status = 'failed', error_code = $2, error_message = $3,
           updated_at = NOW()
       WHERE id = $1 AND organisation_id = $4
       RETURNING id, organisation_id, invoice_id, stage, status`,
      [attemptId, code, message, organisationId],
    );
    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function queueAutomaticReminders({ baseUrl }) {
  // payment_reminder_settings est sous RLS FORCE : cette liste est
  // intentionnellement cross-tenant (job cron en lot), résolue via fonction
  // SECURITY DEFINER plutôt qu'une lecture directe bloquée sur cette
  // connexion non scopée.
  const organisations = await db.query(`SELECT * FROM list_orgs_with_automatic_reminders()`);

  const summary = { organisations: organisations.rowCount, queued: 0, skipped: 0, failed: 0 };

  for (const row of organisations.rows) {
    const organisationId = row.organisation_id;
    const candidates = await paymentReminderService.listCandidates(organisationId);

    for (const candidate of candidates) {
      if (!candidate.can_send || !candidate.next_stage) {
        summary.skipped += 1;
        continue;
      }

      try {
        const result = await paymentReminderService.sendReminder({
          invoiceId: candidate.id,
          organisationId,
          stage: candidate.next_stage,
          mode: "automatic",
          requestedBy: null,
          baseUrl,
          req: null,
        });
        if (result?.duplicate) summary.skipped += 1;
        else if (result) summary.queued += 1;
      } catch (error) {
        summary.failed += 1;
      }
    }
  }

  return summary;
}

module.exports = {
  markAttemptSent,
  markAttemptFailed,
  queueAutomaticReminders,
};
