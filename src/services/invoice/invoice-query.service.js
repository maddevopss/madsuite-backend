const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { scopedOrganisationFilter, calculateEntryHours } = require("./invoice-calculation.service");

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

async function listUnbilledExpenses({ clientId, organisationId }) {
  const params = [clientId];
  const orgFilter = scopedOrganisationFilter("e", params, organisationId);

  const result = await db.query(
    `
    SELECT
      e.id,
      e.montant as amount,
      e.description,
      e.date_depense as date,
      p.nom AS projet_nom
    FROM expenses e
    JOIN projets p ON p.id = e.projet_id
    WHERE p.client_id = $1
      AND e.is_billed = FALSE
      AND e.deleted_at IS NULL
      ${orgFilter}
    ORDER BY e.date_depense ASC
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

module.exports = {
  listInvoices,
  listUnbilledExpenses,
  listUnbilledEntries,
  getInvoiceById,
  getPortalLink,
};
