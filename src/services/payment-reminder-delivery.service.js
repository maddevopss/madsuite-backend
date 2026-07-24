const db = require("../../db");
const paymentReminderService = require("./payment-reminder.service");

async function markAttemptSent(attemptId) {
  if (!attemptId) return null;
  const result = await db.query(
    `UPDATE payment_reminder_attempts
     SET status = 'sent', sent_at = NOW(), error_code = NULL,
         error_message = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING id, organisation_id, invoice_id, stage, status, sent_at`,
    [attemptId],
  );
  return result.rows[0] || null;
}

async function markAttemptFailed(attemptId, error) {
  if (!attemptId) return null;
  const message = String(error?.message || error || "Échec d’envoi").slice(0, 1000);
  const code = String(error?.code || "DELIVERY_FAILED").slice(0, 100);
  const result = await db.query(
    `UPDATE payment_reminder_attempts
     SET status = 'failed', error_code = $2, error_message = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, organisation_id, invoice_id, stage, status`,
    [attemptId, code, message],
  );
  return result.rows[0] || null;
}

async function queueAutomaticReminders({ baseUrl }) {
  const organisations = await db.query(
    `SELECT organisation_id
     FROM payment_reminder_settings
     WHERE automatic_enabled = TRUE`,
  );

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
