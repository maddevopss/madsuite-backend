const db = require("../../db");

const { organisationScope, organisationValue } = require("../utils/organisationScope");
const { renderInvoicePdf } = require("./invoicePdf.service");
const { recordBusinessAudit } = require("./auditLog.service");

function scopedOrganisationFilter(alias, params, organisationId) {
  return organisationScope(alias, params, organisationId).replace(/^AND\s+/, "AND ");
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculateEntryHours(entry) {
  const rawHours = (new Date(entry.end_time) - new Date(entry.start_time)) / 3600000;
  
  if (entry.billing_increment && entry.billing_increment > 1) {
    const incrementHours = entry.billing_increment / 60;
    const type = entry.billing_rounding_type || 'exact';
    
    if (type === 'up') {
      return Math.ceil(rawHours / incrementHours) * incrementHours;
    } else if (type === 'nearest') {
      return Math.round(rawHours / incrementHours) * incrementHours;
    }
  }
  return rawHours;
}

function calculateEntryRate(entry) {
  return Number(entry.hourly_rate_used ?? entry.taux_horaire ?? entry.hourly_rate_defaut ?? 0);
}

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

async function releaseInvoiceTimeEntries(invoiceId, organisationId) {
  const result = await db.query(
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

async function listInvoices({ organisationId, status, clientId }) {
  const params = [];
  const conditions = ["i.deleted_at IS NULL"];

  if (status) {
    params.push(status);
    conditions.push(`i.status = $${params.length}`);
  }

  if (clientId) {
    params.push(Number(clientId));
    conditions.push(`i.client_id = $${params.length}`);
  }

  conditions.push(scopedOrganisationFilter("i", params, organisationId).replace(/^AND\s+/, ""));

  const where = "WHERE " + conditions.join(" AND ");

  const result = await db.query(
    `
    SELECT
      i.id,
      i.invoice_number,
      i.status,
      i.issue_date,
      i.due_date,
      i.subtotal,
      i.tax_total,
      i.total,
      i.notes,
      i.created_at,
      c.id AS client_id,
      c.nom AS client_nom,
      COUNT(DISTINCT te.id) AS entries_count,
      COUNT(DISTINCT ii.id) AS items_count
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
    LEFT JOIN time_entries te ON te.invoice_id = i.id
    ${where}
    GROUP BY i.id, c.id
    ORDER BY i.created_at DESC
    `,
    params,
  );

  return result.rows;
}

async function listUnbilledEntries({ clientId, organisationId }) {
  const params = [clientId];
  const clientOrgFilter = scopedOrganisationFilter("c", params, organisationId);
  const projectOrgFilter = scopedOrganisationFilter("p", params, organisationId);
  const timeEntryOrgFilter = scopedOrganisationFilter("te", params, organisationId);

  const result = await db.query(
    `
    SELECT
      te.id,
      te.projet_id,
      p.nom AS projet_nom,
      c.id AS client_id,
      te.description,
      te.start_time,
      te.end_time,
      p.billing_increment,
      p.billing_rounding_type,
      ROUND(COALESCE(te.hourly_rate_used, p.taux_horaire, c.hourly_rate_defaut, 0), 2) AS hourly_rate_used
    FROM time_entries te
    JOIN projets p ON p.id = te.projet_id
      AND p.deleted_at IS NULL
      ${projectOrgFilter}
    JOIN clients c ON c.id = p.client_id
      AND c.deleted_at IS NULL
      ${clientOrgFilter}
    WHERE c.id = $1
      AND te.end_time IS NOT NULL
      AND te.is_billed = FALSE
      AND te.invoice_id IS NULL
      AND te.deleted_at IS NULL
      ${timeEntryOrgFilter}
    ORDER BY te.start_time ASC, te.id ASC
    `,
    params,
  );

  return result.rows.map(row => {
    const hours = calculateEntryHours(row);
    return {
      ...row,
      hours: Math.round(hours * 100) / 100,
      amount: Math.round(hours * row.hourly_rate_used * 100) / 100
    };
  });
}

async function getInvoiceById({ invoiceId, organisationId }) {
  const params = [invoiceId];
  const conditions = ["i.id = $1", "i.deleted_at IS NULL"];

  const orgFilter = scopedOrganisationFilter("i", params, organisationId);
  const where = "WHERE " + conditions.join(" AND ");

  const invoiceResult = await db.query(
    `
    SELECT i.*, c.nom AS client_nom, c.email AS client_email, c.phone AS client_phone
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    ${where}
    ${orgFilter}
    `,
    params,
  );

  const invoice = invoiceResult.rows[0];

  if (!invoice) {
    return null;
  }

  const itemsResult = await db.query(
    `
    SELECT ii.*, te.start_time, te.end_time, te.description AS entry_description,
           p.nom AS projet_nom
    FROM invoice_items ii
    LEFT JOIN time_entries te ON te.id = ii.time_entry_id
    LEFT JOIN projets p ON p.id = te.projet_id
    WHERE ii.invoice_id = $1
      AND ii.organisation_id = $2
    ORDER BY ii.created_at ASC
    `,
    [invoiceId, organisationValue(organisationId)],
  );

  return {
    ...invoice,
    items: itemsResult.rows,
  };
}

async function fetchValidEntries({ requestedEntryIds, clientId, organisationId, lock = false, client = db }) {
  const params = [requestedEntryIds, clientId];
  const clientOrgFilter = scopedOrganisationFilter("c", params, organisationId);
  const projectOrgFilter = scopedOrganisationFilter("p", params, organisationId);
  const timeEntryOrgFilter = scopedOrganisationFilter("te", params, organisationId);

  const entriesResult = await client.query(
    `
    SELECT te.*, p.nom AS projet_nom, p.taux_horaire, p.billing_increment, p.billing_rounding_type, c.hourly_rate_defaut
    FROM time_entries te
    JOIN projets p ON p.id = te.projet_id
    JOIN clients c ON c.id = p.client_id
    WHERE te.id = ANY($1)
      AND c.id = $2
      AND te.end_time IS NOT NULL
      AND te.is_billed = FALSE
      AND te.invoice_id IS NULL
      AND te.deleted_at IS NULL
      ${clientOrgFilter}
      ${projectOrgFilter}
      ${timeEntryOrgFilter}
    ORDER BY te.start_time ASC, te.id ASC
    ${lock ? "FOR UPDATE OF te" : ""}
    `,
    params,
  );

  return entriesResult.rows;
}

async function createInvoiceFromEntries({
  clientId,
  timeEntryIds,
  issueDate,
  dueDate,
  notes,
  taxRate,
  organisationId,
  billedBy,
  req,
}) {
  const requestedEntryIds = [...new Set(timeEntryIds)];
  const txClient = await db.pool.connect();
  try {
    await txClient.query("BEGIN");

    const entries = await fetchValidEntries({
      requestedEntryIds,
      clientId,
      organisationId,
      lock: true,
      client: txClient,
    });

    if (entries.length === 0) {
      const err = new Error("Aucune entrée de temps sélectionnable pour ce client.");
      err.statusCode = 400;
      throw err;
    }

    if (entries.length !== requestedEntryIds.length) {
      const err = new Error("Certaines entrées de temps sont invalides, déjà facturées ou hors organisation.");
      err.statusCode = 400;
      throw err;
    }

    const validEntryIds = entries.map((entry) => entry.id);
    const invoiceNumber = await getNextInvoiceNumber(organisationId, txClient);

    let subtotal = 0;

    for (const entry of entries) {
      const hours = calculateEntryHours(entry);
      const rate = calculateEntryRate(entry);
      subtotal += roundMoney(hours * rate);
    }

    const taxTotal = subtotal * (Number(taxRate || 0) / 100);
    const total = subtotal + taxTotal;
    const billedAt = new Date();

    const invoiceResult = await txClient.query(
      `
      INSERT INTO invoices
        (
          client_id,
          invoice_number,
          status,
          issue_date,
          due_date,
          subtotal,
          tax_total,
          total,
          notes,
          organisation_id,
          billed_at,
          billed_by
        )
      VALUES ($1, $2, 'draft', $3::date, $4::date, $5, $6, $7, $8, $9, $10::timestamptz, $11)
      RETURNING *
      `,
      [
        clientId,
        invoiceNumber,
        issueDate || new Date().toISOString().slice(0, 10),
        dueDate || null,
        roundMoney(subtotal),
        roundMoney(taxTotal),
        roundMoney(total),
        notes || null,
        organisationValue(organisationId),
        billedAt.toISOString(),
        billedBy,
      ],
    );

    const invoice = invoiceResult.rows[0];

    const itemValues = [];
    const itemParams = [];
    let paramIdx = 1;

    for (const entry of entries) {
      const hours = calculateEntryHours(entry);
      const rate = calculateEntryRate(entry);
      const amount = roundMoney(hours * rate);

      itemValues.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`,
      );

      itemParams.push(
        organisationValue(organisationId),
        invoice.id,
        entry.id,
        entry.description || entry.projet_nom || "Prestation",
        Math.round(hours * 100) / 100,
        roundMoney(rate),
        amount,
        new Date().toISOString(),
      );

      paramIdx += 8;
    }

    await txClient.query(
      `
      INSERT INTO invoice_items
        (
          organisation_id,
          invoice_id,
          time_entry_id,
          description,
          quantity,
          unit_rate,
          amount,
          created_at
        )
      VALUES ${itemValues.join(", ")}
      `,
      itemParams,
    );

    const updatedEntries = await txClient.query(
      `
      UPDATE time_entries
      SET is_billed = TRUE,
          invoice_id = $1
      WHERE id = ANY($2)
        AND organisation_id = $3
        AND end_time IS NOT NULL
        AND is_billed = FALSE
        AND invoice_id IS NULL
      `,
      [invoice.id, validEntryIds, organisationValue(organisationId)],
    );

    if (updatedEntries.rowCount !== validEntryIds.length) {
      // On conserve l'idempotence / anti double facturation même en concurrence.
      const err = new Error("Certaines entrées ont été réservées dans une autre facture en parallèle.");
      err.statusCode = 409;
      throw err;
    }

    await txClient.query("COMMIT");

    await recordBusinessAudit({
      organisationId,
      actorUserId: req?.user?.id ?? null,
      action: "invoice.created",
      entityType: "invoice",
      entityId: invoice.id,
      details: {
        clientId: clientId,
        timeEntryCount: requestedEntryIds.length,
      },
      req,
    });

    return invoice;
  } catch (err) {
    try {
      await txClient.query("ROLLBACK");
    } catch (_) {}
    throw err;
  } finally {
    txClient.release();
  }
}

async function updateInvoice({ invoiceId, organisationId, data, req }) {
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

  try {
    const currentResult = await db.query(
      `
      SELECT id, status
      FROM invoices
      WHERE ${conditions.join(" AND ")}
      FOR UPDATE
      `,
      params.slice(0, 2),
    );
    const currentInvoice = currentResult.rows[0];

    if (!currentInvoice) {
      return null;
    }

    if (data.status !== undefined) {
      const allowedTransitions = {
        draft: ["draft", "sent", "paid", "void"],
        sent: ["sent", "paid", "void"],
        paid: ["paid", "void"],
        void: ["void"],
      };

      if (!allowedTransitions[currentInvoice.status]?.includes(data.status)) {
        const err = new Error(`Transition de statut invalide: ${currentInvoice.status} vers ${data.status}.`);
        err.statusCode = 409;
        throw err;
      }
    }

    const result = await db.query(
      `
      UPDATE invoices
      SET ${updates.join(", ")}
      WHERE ${conditions.join(" AND ")}
      RETURNING *
      `,
      params,
    );

    if (data.status === "sent" || data.status === "paid") {
      await db.query(
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
      await releaseInvoiceTimeEntries(invoiceId, organisationId);
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
    }

    return updatedInvoice;
  } catch (err) {
    throw err;
  }
}

async function deleteInvoice({ invoiceId, organisationId, req }) {
  const params = [invoiceId, organisationValue(organisationId)];

  try {
    const invoice = await lockInvoiceForDelete(invoiceId, organisationId);

    if (!invoice) {
      return null;
    }

    if (invoice.status !== "draft") {
      const err = new Error("Seule une facture brouillon peut être supprimée. Annulez plutôt une facture déjà émise.");
      err.statusCode = 409;
      throw err;
    }

    const releasedEntries = await releaseInvoiceTimeEntries(invoiceId, organisationId);
    const result = await db.query(
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

    return {
      ...result.rows[0],
      released_entries: releasedEntries,
    };
  } catch (err) {
    throw err;
  }
}

async function generateInvoicePdf({ invoiceId, organisationId }) {
  const invoice = await getInvoiceById({
    invoiceId,
    organisationId,
  });

  if (!invoice) {
    return null;
  }

  return {
    invoice,
    buffer: renderInvoicePdf(invoice),
  };
}

async function getPortalLink({ invoiceId, organisationId, baseUrl }) {
  const result = await db.query(
    `SELECT id, public_token, status FROM invoices WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL`,
    [invoiceId, organisationValue(organisationId)],
  );

  if (!result.rows[0]) {
    return null;
  }

  const { public_token, status } = result.rows[0];
  const portalUrl = `${baseUrl}/portal/${public_token}`;
  return { portalUrl, public_token, status };
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

  return { invoice, portalUrl };
}

module.exports = {
  getNextInvoiceNumber,
  listInvoices,
  listUnbilledEntries,
  getInvoiceById,
  createInvoiceFromEntries,
  updateInvoice,
  deleteInvoice,
  generateInvoicePdf,
  getPortalLink,
  markInvoiceAsSent,
};
