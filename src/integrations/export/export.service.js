const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");

/**
 * Convert an array of objects to a CSV string.
 */
function toCSV(data) {
  if (!data || data.length === 0) return "";
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers
      .map((header) => {
        let value = row[header];
        if (value === null || value === undefined) value = "";
        value = String(value);
        if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
          value = `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      })
      .join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

async function exportInvoicesToCSV(organisationId, { startDate, endDate } = {}) {
  const orgId = organisationValue(organisationId);
  const params = [orgId];
  const conditions = ["i.organisation_id = $1", "i.deleted_at IS NULL"];

  if (startDate) {
    params.push(startDate);
    conditions.push(`i.issue_date >= $${params.length}::date`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`i.issue_date <= $${params.length}::date`);
  }

  const query = `
    SELECT 
      i.invoice_number AS "InvoiceNumber",
      c.nom AS "CustomerName",
      i.status AS "Status",
      i.issue_date AS "IssueDate",
      i.due_date AS "DueDate",
      i.subtotal AS "Subtotal",
      i.tax_total AS "Tax",
      i.total AS "Total",
      i.notes AS "Notes",
      i.created_at AS "CreatedAt"
    FROM invoices i
    LEFT JOIN clients c ON i.client_id = c.id AND c.organisation_id = $1
    WHERE ${conditions.join(" AND ")}
    ORDER BY i.issue_date DESC, i.id DESC
  `;

  const result = await db.query(query, params);
  return toCSV(result.rows);
}

async function exportExpensesToCSV(organisationId, { startDate, endDate } = {}) {
  const orgId = organisationValue(organisationId);
  const params = [orgId];
  const conditions = ["e.organisation_id = $1", "e.deleted_at IS NULL"];

  if (startDate) {
    params.push(startDate);
    conditions.push(`e.date_depense >= $${params.length}::date`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`e.date_depense <= $${params.length}::date`);
  }

  const query = `
    SELECT
      e.id AS "ExpenseID",
      p.nom AS "ProjectName",
      c.nom AS "CustomerName",
      e.date_depense AS "Date",
      e.montant AS "Amount",
      e.description AS "Description",
      e.is_billed AS "IsBilled",
      e.invoice_id AS "InvoiceID",
      e.created_at AS "CreatedAt"
    FROM expenses e
    LEFT JOIN projets p ON e.projet_id = p.id AND p.organisation_id = $1
    LEFT JOIN clients c ON p.client_id = c.id AND c.organisation_id = $1
    WHERE ${conditions.join(" AND ")}
    ORDER BY e.date_depense DESC, e.id DESC
  `;

  const result = await db.query(query, params);
  return toCSV(result.rows);
}

async function exportLedgerToCSV(organisationId, { startDate, endDate } = {}) {
  const orgId = organisationValue(organisationId);
  const params = [orgId];
  const conditions = ["organisation_id = $1"];

  if (startDate) {
    params.push(startDate);
    conditions.push(`created_at >= $${params.length}::date`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`created_at <= $${params.length}::date`);
  }

  const query = `
    SELECT
      id AS "LedgerID",
      type AS "Type",
      amount AS "Amount",
      currency AS "Currency",
      reference_type AS "ReferenceType",
      reference_id AS "ReferenceID",
      created_at AS "CreatedAt"
    FROM ledger_entries
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC, id DESC
  `;

  const result = await db.query(query, params);
  return toCSV(result.rows);
}

module.exports = {
  exportInvoicesToCSV,
  exportExpensesToCSV,
  exportLedgerToCSV,
};
