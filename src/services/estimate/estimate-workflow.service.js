const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { getNextInvoiceNumber } = require("../invoice/invoice-finalization.service");
const analyticsService = require("../analytics.service");
const { createProject } = require("../projets.service");
const { getEstimateById } = require("./estimate-query.service");

function serviceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function findExistingInvoice({ organisationId, estimateId, idempotencyKey, client = db }) {
  const result = await client.query(
    `SELECT *
       FROM invoices
      WHERE organisation_id = $1
        AND (estimate_id = $2 OR idempotency_key = $3)
      ORDER BY CASE WHEN idempotency_key = $3 THEN 0 ELSE 1 END
      LIMIT 1`,
    [organisationValue(organisationId), estimateId, idempotencyKey],
  );
  return result.rows[0] || null;
}

async function convertToInvoice({ estimateId, organisationId, billedBy, idempotencyKey }) {
  const txClient = await db.pool.connect();
  let committedInvoice;
  try {
    await txClient.query("BEGIN");
    await txClient.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationValue(organisationId))]);
    const sameCommand = await txClient.query(
      `SELECT * FROM invoices
        WHERE organisation_id = $1 AND idempotency_key = $2
        FOR SHARE`,
      [organisationValue(organisationId), idempotencyKey],
    );
    if (sameCommand.rows.length > 0) {
      const invoice = sameCommand.rows[0];
      if (Number(invoice.estimate_id) !== Number(estimateId)) {
        throw serviceError("Cette clé d'idempotence appartient à une autre soumission.", 409);
      }
      await txClient.query("COMMIT");
      return { invoice, replayed: true };
    }

    const estimateResult = await txClient.query(
      `SELECT * FROM estimates
        WHERE id = $1 AND organisation_id = $2
        FOR UPDATE`,
      [estimateId, organisationValue(organisationId)],
    );
    const estimate = estimateResult.rows[0];
    if (!estimate) throw serviceError("Soumission introuvable.", 404);

    const alreadyConverted = await txClient.query(
      `SELECT * FROM invoices
        WHERE organisation_id = $1 AND estimate_id = $2
        FOR SHARE`,
      [organisationValue(organisationId), estimateId],
    );
    if (alreadyConverted.rows.length > 0) {
      await txClient.query("COMMIT");
      return { invoice: alreadyConverted.rows[0], replayed: true };
    }
    if (estimate.status !== "accepted") {
      throw serviceError("Seule une soumission acceptée peut être convertie en facture.", 400);
    }

    const itemsResult = await txClient.query(
      `SELECT * FROM estimate_items
        WHERE estimate_id = $1 AND organisation_id = $2
        ORDER BY id`,
      [estimateId, organisationValue(organisationId)],
    );
    const invoiceNumber = await getNextInvoiceNumber(organisationId, txClient);
    const billedAt = new Date();
    const invoiceResult = await txClient.query(
      `INSERT INTO invoices
        (client_id, estimate_id, invoice_number, status, issue_date, due_date,
         subtotal, tax_total, total, notes, organisation_id, billed_at, billed_by, idempotency_key)
       VALUES ($1, $2, $3, 'draft', CURRENT_DATE, NULL,
               $4, $5, $6, $7, $8, $9::timestamptz, $10, $11)
       RETURNING *`,
      [
        estimate.client_id,
        estimate.id,
        invoiceNumber,
        estimate.subtotal,
        estimate.tax_total,
        estimate.total,
        estimate.notes || null,
        organisationValue(organisationId),
        billedAt.toISOString(),
        billedBy,
        idempotencyKey,
      ],
    );
    const invoice = invoiceResult.rows[0];

    for (const item of itemsResult.rows) {
      await txClient.query(
        `INSERT INTO invoice_items
          (organisation_id, invoice_id, time_entry_id, description, quantity,
           unit_rate, amount, created_at, original_description)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7)`,
        [organisationValue(organisationId), invoice.id, item.description, item.quantity, item.unit_rate, item.amount, item.description],
      );
    }

    const updated = await txClient.query(
      `UPDATE estimates
          SET status = 'invoiced', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND organisation_id = $2 AND status = 'accepted'`,
      [estimateId, organisationValue(organisationId)],
    );
    if (updated.rowCount !== 1) throw serviceError("La soumission a changé pendant la conversion.", 409);
    await txClient.query("COMMIT");
    committedInvoice = invoice;
  } catch (error) {
    try { await txClient.query("ROLLBACK"); } catch (_) {}
    if (error.code === "23505") {
      const existing = await findExistingInvoice({ organisationId, estimateId, idempotencyKey });
      if (existing && Number(existing.estimate_id) === Number(estimateId)) {
        return { invoice: existing, replayed: true };
      }
      throw serviceError("Conflit d'idempotence lors de la conversion.", 409);
    }
    throw error;
  } finally {
    txClient.release();
  }

  await analyticsService.trackEvent("invoice_created", {
    organisationId,
    userId: billedBy,
    metadata: {
      invoiceId: committedInvoice.id,
      invoiceNumber: committedInvoice.invoice_number,
      total: committedInvoice.total,
      isFromEstimate: true,
      estimateId,
    },
  });
  return { invoice: committedInvoice, replayed: false };
}

async function convertToProject({ estimateId, organisationId }) {
  const estimate = await getEstimateById(estimateId, organisationId);
  if (!estimate) throw serviceError("Soumission introuvable.", 404);
  if (estimate.status !== "accepted") {
    throw serviceError("Seule une soumission acceptée peut être convertie en projet.", 400);
  }

  const budgetHeures = (estimate.items || []).reduce((acc, item) => acc + Number(item.quantity || 0), 0);
  return createProject({
    data: {
      client_id: estimate.client_id,
      nom: `Projet Soumission ${estimate.estimate_number}`,
      description: estimate.notes || `Généré depuis la soumission ${estimate.estimate_number}`,
      budget_hours: budgetHeures,
      taux_horaire: estimate.items?.length ? estimate.items[0].unit_rate : 0,
      couleur: "#28a745",
    },
    organisationId,
  });
}

module.exports = {
  convertToInvoice,
  convertToProject,
};
