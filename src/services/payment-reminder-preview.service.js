const db = require("../../db");
const { organisationValue } = require("../utils/organisationScope");
const { STAGES, buildPreview } = require("./payment-reminder.service");

async function previewReminder({ invoiceId, organisationId, stage }) {
  const numericStage = Number(stage);
  if (!STAGES.includes(numericStage)) {
    throw Object.assign(new Error("Étape de relance invalide."), { statusCode: 400 });
  }

  const result = await db.query(
    `SELECT i.id, i.invoice_number, i.total, i.due_date, i.status,
            i.finalized_at, c.nom AS client_name, c.email AS client_email,
            (CURRENT_DATE - i.due_date::date)::int AS days_overdue
     FROM invoices i
     JOIN clients c ON c.id = i.client_id AND c.organisation_id = i.organisation_id
     WHERE i.id = $1
       AND i.organisation_id = $2
       AND i.deleted_at IS NULL`,
    [invoiceId, organisationValue(organisationId)],
  );

  const invoice = result.rows[0];
  if (!invoice) return null;
  if (invoice.status !== "sent" || !invoice.finalized_at || !invoice.due_date || Number(invoice.days_overdue) < numericStage) {
    throw Object.assign(new Error("Cette facture ne peut pas être relancée à cette étape."), { statusCode: 409 });
  }
  if (!invoice.client_email) {
    throw Object.assign(new Error("Le client n’a aucune adresse courriel."), { statusCode: 409 });
  }

  return {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    client_name: invoice.client_name,
    total: invoice.total,
    due_date: invoice.due_date,
    days_overdue: invoice.days_overdue,
    ...buildPreview(invoice, numericStage, null),
    portal_link_created_on_send: true,
  };
}

module.exports = { previewReminder };
