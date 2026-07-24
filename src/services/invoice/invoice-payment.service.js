const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { recordBusinessAudit } = require("../auditLog.service");
const { getInvoiceById } = require("./invoice-query.service");
const { checkInvoiceModification, validateTransition } = require("./invoice-validation.service");
const { lockInvoiceForDelete } = require("./invoice-finalization.service");
const analyticsService = require("../analytics.service");

async function releaseInvoiceTimeEntries(invoiceId, organisationId, txClient = null) {
  const queryFn = txClient ? txClient.query.bind(txClient) : db.query.bind(db);
  const result = await queryFn(
    `
    UPDATE time_entries
    SET is_billed = FALSE,
        invoice_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE invoice_id = $1
      AND organisation_id = $2
    RETURNING id
    `,
    [invoiceId, organisationValue(organisationId)],
  );

  return result.rowCount;
}

async function updateInvoice({ invoiceId, organisationId, data, req, txClient = null }) {
  const params = [invoiceId, organisationValue(organisationId)];
  const conditions = ["id = $1", "organisation_id = $2", "deleted_at IS NULL"];

  const updates = [];
  let paramIdx = params.length + 1;

  if (data.status !== undefined) {
    updates.push(`status = $${paramIdx}`);
    params.push(data.status);
    paramIdx++;
  }

  if (data.issue_date !== undefined) {
    updates.push(`issue_date = $${paramIdx}::date`);
    params.push(data.issue_date);
    paramIdx++;
  }

  if (data.due_date !== undefined) {
    updates.push(`due_date = $${paramIdx}::date`);
    params.push(data.due_date);
    paramIdx++;
  }

  if (data.notes !== undefined) {
    updates.push(`notes = $${paramIdx}`);
    params.push(data.notes);
    paramIdx++;
  }

  if (updates.length === 0) {
    const err = new Error("Aucune mise à jour fournie.");
    err.statusCode = 400;
    throw err;
  }

  if (data.version !== undefined) {
    conditions.push(`version = $${paramIdx}`);
    params.push(data.version);
  }

  const isExternalTx = !!txClient;
  const client = txClient || await db.pool.connect();

  try {
    if (!isExternalTx) {
      await client.query("BEGIN");
    }

    const currentResult = await client.query(
      `
      SELECT id, status, version
      FROM invoices
      WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
      FOR UPDATE
      `,
      params.slice(0, 2),
    );
    const currentInvoice = currentResult.rows[0];

    if (!currentInvoice) {
      const err = new Error("Facture introuvable.");
      err.statusCode = 404;
      throw err;
    }
    
    if (data.version !== undefined && currentInvoice.version !== data.version) {
      const err = new Error("Conflit de version.");
      err.statusCode = 409;
      throw err;
    }

    checkInvoiceModification(currentInvoice, data);

    if (data.status !== undefined) {
      validateTransition(currentInvoice.status, data.status);
    }

    updates.push(`version = version + 1`);

    let returningQuery = `
      UPDATE invoices
      SET ${updates.join(", ")}
      WHERE id = $1 AND organisation_id = $2
      RETURNING *
    `;

    const result = await client.query(returningQuery, params);

    if (data.status === "sent" || data.status === "paid") {
      await client.query(
        `
        UPDATE time_entries
        SET is_billed = TRUE,
            updated_at = CURRENT_TIMESTAMP
        WHERE invoice_id = $1
          AND organisation_id = $2
        `,
        [invoiceId, organisationValue(organisationId)],
      );
    } else if (data.status === "void") {
      await releaseInvoiceTimeEntries(invoiceId, organisationId, client);
    }

    const updatedInvoice = result.rows[0] || null;
    
    if (updatedInvoice) {
      await recordBusinessAudit({
        organisationId,
        actorUserId: req?.user?.id ?? null,
        action: "invoice.updated",
        entityType: "invoice",
        entityId: updatedInvoice.id,
        details: {
          status: data.status ?? null,
          issueDate: data.issue_date ?? null,
          dueDate: data.due_date ?? null,
        },
        req,
      });

      if (data.status === "paid") {
        await analyticsService.trackEvent("invoice_paid", {
          organisationId,
          userId: req?.user?.id ?? null,
          metadata: {
            invoiceId: updatedInvoice.id,
            total: updatedInvoice.total,
          }
        });
      }
    }

    if (!isExternalTx) {
      await client.query("COMMIT");
    }

    return updatedInvoice;
  } catch (err) {
    if (!isExternalTx && client) {
      await client.query("ROLLBACK");
    }
    throw err;
  } finally {
    if (!isExternalTx && client) {
      client.release();
    }
  }
}

async function deleteInvoice({ invoiceId, organisationId, req, txClient = null }) {
  const params = [invoiceId, organisationValue(organisationId)];

  const isExternalTx = !!txClient;
  const client = txClient || await db.pool.connect();

  try {
    if (!isExternalTx) {
      await client.query("BEGIN");
    }

    const lockRes = await client.query(
      `
      SELECT id, status
      FROM invoices
      WHERE id = $1
        AND organisation_id = $2
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      params
    );
    const invoice = lockRes.rows[0];

    if (!invoice) {
      if (!isExternalTx) await client.query("ROLLBACK");
      return null;
    }

    if (invoice.status !== "draft") {
      const err = new Error("Seule une facture brouillon peut être supprimée. Annulez plutôt une facture déjà émise.");
      err.statusCode = 409;
      throw err;
    }

    const releasedEntries = await releaseInvoiceTimeEntries(invoiceId, organisationId, client);
    const result = await client.query(
      `
      UPDATE invoices
      SET deleted_at = NOW()
      WHERE id = $1
        AND organisation_id = $2
        AND deleted_at IS NULL
      RETURNING id
      `,
      params,
    );

    if (!result.rows[0]) {
      if (!isExternalTx) await client.query("ROLLBACK");
      return null;
    }

    await recordBusinessAudit({
      organisationId,
      actorUserId: req?.user?.id ?? null,
      action: "invoice.deleted",
      entityType: "invoice",
      entityId: invoiceId,
      details: {
        releasedEntries: releasedEntries || 0,
      },
      req,
    });

    if (!isExternalTx) {
      await client.query("COMMIT");
    }

    return {
      ...result.rows[0],
      released_entries: releasedEntries,
    };
  } catch (err) {
    if (!isExternalTx && client) {
      await client.query("ROLLBACK");
    }
    throw err;
  } finally {
    if (!isExternalTx && client) {
      client.release();
    }
  }
}

async function markInvoiceAsSent({ invoiceId, organisationId, req, baseUrl }) {
  const invoice = await updateInvoice({
    invoiceId,
    organisationId,
    data: { status: "sent" },
    req,
  });

  if (!invoice) return null;

  const portalUrl = `${baseUrl}/portal/${invoice.public_token}`;

  await recordBusinessAudit({
    organisationId,
    actorUserId: req?.user?.id ?? null,
    action: "invoice.sent",
    entityType: "invoice",
    entityId: invoice.id,
    details: { portalUrl },
    req,
  });

  await analyticsService.trackEvent("invoice_sent", {
    organisationId,
    userId: req?.user?.id ?? null,
    metadata: {
      invoiceId: invoice.id,
    }
  });

  return { invoice, portalUrl };
}

module.exports = {
  releaseInvoiceTimeEntries,
  updateInvoice,
  deleteInvoice,
  markInvoiceAsSent,
};
