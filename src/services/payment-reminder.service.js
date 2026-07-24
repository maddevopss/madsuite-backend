const db = require("../../db");
const outboxService = require("./outbox.service");
const { organisationValue } = require("../utils/organisationScope");
const { createInvoicePublicLink } = require("./invoice/invoice-public-link.service");

const STAGES = [3, 7, 14];

function stageType(stage) {
  if (stage === 3) return "gentle";
  if (stage === 7) return "firm";
  if (stage === 14) return "final";
  throw Object.assign(new Error("Étape de relance invalide."), { statusCode: 400 });
}

function nextStage(daysOverdue, completedStages = []) {
  return STAGES.find((stage) => daysOverdue >= stage && !completedStages.includes(stage)) || null;
}

function buildPreview(invoice, stage, portalUrl) {
  const labels = {
    3: "Rappel amical",
    7: "Deuxième rappel",
    14: "Dernier rappel amiable",
  };
  return {
    stage,
    type: stageType(stage),
    subject: `${labels[stage]} — facture ${invoice.invoice_number}`,
    recipient: invoice.client_email,
    message: `La facture ${invoice.invoice_number} de ${Number(invoice.total).toFixed(2)} $ CA était due le ${invoice.due_date}.`,
    portal_url: portalUrl || null,
  };
}

async function getSettings(organisationId) {
  const result = await db.query(
    `SELECT automatic_enabled, updated_at
     FROM payment_reminder_settings
     WHERE organisation_id = $1`,
    [organisationValue(organisationId)],
  );
  return result.rows[0] || { automatic_enabled: false, updated_at: null };
}

async function updateSettings({ organisationId, automaticEnabled, updatedBy }) {
  const result = await db.query(
    `INSERT INTO payment_reminder_settings (organisation_id, automatic_enabled, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (organisation_id)
     DO UPDATE SET automatic_enabled = EXCLUDED.automatic_enabled,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = NOW()
     RETURNING automatic_enabled, updated_at`,
    [organisationValue(organisationId), Boolean(automaticEnabled), updatedBy || null],
  );
  return result.rows[0];
}

async function listCandidates(organisationId) {
  const result = await db.query(
    `SELECT i.id, i.invoice_number, i.total, i.due_date, i.status,
            i.finalized_at, c.nom AS client_name, c.email AS client_email,
            (CURRENT_DATE - i.due_date::date)::int AS days_overdue,
            COALESCE(array_agg(a.stage) FILTER (WHERE a.status IN ('queued', 'sent')), '{}') AS completed_stages
     FROM invoices i
     JOIN clients c ON c.id = i.client_id AND c.organisation_id = i.organisation_id
     LEFT JOIN payment_reminder_attempts a
       ON a.invoice_id = i.id AND a.organisation_id = i.organisation_id
     WHERE i.organisation_id = $1
       AND i.status = 'sent'
       AND i.finalized_at IS NOT NULL
       AND i.deleted_at IS NULL
       AND i.due_date IS NOT NULL
       AND i.due_date < CURRENT_DATE
     GROUP BY i.id, c.nom, c.email
     ORDER BY i.due_date ASC`,
    [organisationValue(organisationId)],
  );

  return result.rows.map((row) => {
    const completed = (row.completed_stages || []).map(Number);
    const stage = nextStage(Number(row.days_overdue), completed);
    return {
      ...row,
      completed_stages: completed,
      next_stage: stage,
      can_send: Boolean(stage && row.client_email),
      stop_reason: stage ? (row.client_email ? null : "client_email_missing") : "no_stage_due",
    };
  });
}

async function getInvoiceCandidate({ invoiceId, organisationId, client = db }) {
  const result = await client.query(
    `SELECT i.*, c.nom AS client_name, c.email AS client_email,
            (CURRENT_DATE - i.due_date::date)::int AS days_overdue
     FROM invoices i
     JOIN clients c ON c.id = i.client_id AND c.organisation_id = i.organisation_id
     WHERE i.id = $1 AND i.organisation_id = $2 AND i.deleted_at IS NULL`,
    [invoiceId, organisationValue(organisationId)],
  );
  return result.rows[0] || null;
}

async function listHistory({ organisationId, invoiceId }) {
  const params = [organisationValue(organisationId)];
  let invoiceClause = "";
  if (invoiceId) {
    params.push(invoiceId);
    invoiceClause = "AND a.invoice_id = $2";
  }
  const result = await db.query(
    `SELECT a.id, a.invoice_id, i.invoice_number, a.stage, a.mode, a.status,
            a.recipient, a.subject, a.error_code, a.error_message,
            a.requested_at, a.sent_at, a.updated_at
     FROM payment_reminder_attempts a
     JOIN invoices i ON i.id = a.invoice_id AND i.organisation_id = a.organisation_id
     WHERE a.organisation_id = $1 ${invoiceClause}
     ORDER BY a.requested_at DESC`,
    params,
  );
  return result.rows;
}

async function sendReminder({ invoiceId, organisationId, stage, mode = "manual", requestedBy, baseUrl, req }) {
  if (!STAGES.includes(Number(stage))) {
    throw Object.assign(new Error("Étape de relance invalide."), { statusCode: 400 });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const invoice = await getInvoiceCandidate({ invoiceId, organisationId, client });
    if (!invoice) {
      await client.query("ROLLBACK");
      return null;
    }
    if (invoice.status !== "sent" || !invoice.finalized_at || !invoice.due_date || Number(invoice.days_overdue) < Number(stage)) {
      throw Object.assign(new Error("Cette facture ne peut pas être relancée à cette étape."), { statusCode: 409 });
    }
    if (!invoice.client_email) {
      throw Object.assign(new Error("Le client n’a aucune adresse courriel."), { statusCode: 409 });
    }

    const existing = await client.query(
      `SELECT id, status FROM payment_reminder_attempts
       WHERE organisation_id = $1 AND invoice_id = $2 AND stage = $3
       FOR UPDATE`,
      [organisationValue(organisationId), invoiceId, Number(stage)],
    );
    if (existing.rows[0] && ["queued", "sent"].includes(existing.rows[0].status)) {
      return { duplicate: true, attempt_id: existing.rows[0].id, status: existing.rows[0].status };
    }

    const link = await createInvoicePublicLink({
      invoiceId,
      organisationId,
      createdBy: requestedBy,
      baseUrl,
      expiresInDays: 30,
      req,
    });
    const preview = buildPreview(invoice, Number(stage), link.portalUrl);

    const attempt = await client.query(
      `INSERT INTO payment_reminder_attempts
        (organisation_id, invoice_id, stage, mode, status, recipient, subject,
         portal_link_expires_at, requested_by)
       VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8)
       ON CONFLICT (organisation_id, invoice_id, stage)
       DO UPDATE SET mode = EXCLUDED.mode, status = 'queued', recipient = EXCLUDED.recipient,
                     subject = EXCLUDED.subject, portal_link_expires_at = EXCLUDED.portal_link_expires_at,
                     requested_by = EXCLUDED.requested_by, error_code = NULL, error_message = NULL,
                     requested_at = NOW(), updated_at = NOW()
       RETURNING id`,
      [organisationValue(organisationId), invoiceId, Number(stage), mode, preview.recipient,
        preview.subject, link.expires_at, requestedBy || null],
    );

    await outboxService.insertEvent(client, "dunning_reminder", {
      email: invoice.client_email,
      invoice: { ...invoice, portal_url: link.portalUrl },
      subType: stageType(Number(stage)),
      reminderAttemptId: attempt.rows[0].id,
    });

    await client.query("COMMIT");
    return { duplicate: false, attempt_id: attempt.rows[0].id, status: "queued", preview };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  STAGES,
  stageType,
  nextStage,
  buildPreview,
  getSettings,
  updateSettings,
  listCandidates,
  listHistory,
  sendReminder,
};
