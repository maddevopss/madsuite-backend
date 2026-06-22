const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { recordLedgerEntry } = require("./invoice-ledger.service");
const { getInvoiceById } = require("./invoice-query.service");

async function lockInvoiceNumberSequence(organisationId, client = db) {
  await client.query("SELECT pg_advisory_xact_lock(482019, COALESCE($1::int, 0))", [organisationValue(organisationId)]);
}

async function getNextInvoiceNumber(organisationId, client = db) {
  await lockInvoiceNumberSequence(organisationId, client);
  const seqResult = await client.query(
    `
    SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '([0-9]+)$') AS INTEGER)), 0) + 1 AS next_seq
    FROM invoices
    WHERE organisation_id = $1
    `,
    [organisationValue(organisationId)],
  );
  return `FAC-${String(seqResult.rows[0].next_seq).padStart(5, "0")}`;
}

async function freezeInvoiceSnapshot(invoiceId, organisationId) {
  const invoice = await getInvoiceById({ invoiceId, organisationId });
  if (!invoice) throw new Error("Facture introuvable");
  if (invoice.status !== "draft") throw new Error("Facture déjà finalisée");

  const snapshot = {
    subtotal: invoice.subtotal,
    tax_total: invoice.tax_total,
    total: invoice.total,
    items: invoice.items,
  };

  const result = await db.query(
    `
    UPDATE invoices
    SET status = 'finalized',
        finalized_at = NOW(),
        snapshot = $1::jsonb,
        version = version + 1
    WHERE id = $2 AND organisation_id = $3 AND status = 'draft'
    RETURNING *
    `,
    [JSON.stringify(snapshot), invoiceId, organisationValue(organisationId)]
  );

  if (result.rowCount === 0) {
    throw new Error("Impossible de finaliser la facture. Elle a peut-être déjà été modifiée.");
  }

  await recordLedgerEntry({
    organisationId,
    type: "invoice_created",
    amount: invoice.total,
    currency: "CAD",
    referenceType: "invoice",
    referenceId: String(invoice.id),
  });

  return result.rows[0];
}

async function lockInvoiceForDelete(invoiceId, organisationId) {
  const result = await db.query(
    `
    SELECT id, status
    FROM invoices
    WHERE id = $1
      AND organisation_id = $2
      AND deleted_at IS NULL
    FOR UPDATE
    `,
    [invoiceId, organisationValue(organisationId)],
  );

  return result.rows[0] || null;
}

module.exports = {
  lockInvoiceNumberSequence,
  getNextInvoiceNumber,
  freezeInvoiceSnapshot,
  lockInvoiceForDelete
};
