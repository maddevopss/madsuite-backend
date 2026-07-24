const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { calculateEntryHours, calculateEntryRate, roundMoney } = require("./invoice-calculation.service");

function normalizeTaxRate(value) {
  const taxRate = Number(value || 0);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    const error = new Error("Taux de taxe invalide");
    error.statusCode = 400;
    throw error;
  }
  return taxRate;
}

async function getTimeBillingPreview({ organisationId, clientId, projectId, from, to, taxRate = 0 }) {
  const params = [organisationValue(organisationId), Number(clientId)];
  const conditions = [
    "te.organisation_id = $1",
    "c.id = $2",
    "te.deleted_at IS NULL",
    "te.end_time IS NOT NULL",
    "te.is_billed = FALSE",
    "te.invoice_id IS NULL",
    "p.deleted_at IS NULL",
    "c.deleted_at IS NULL",
  ];

  if (projectId) {
    params.push(Number(projectId));
    conditions.push(`p.id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`te.start_time >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`te.start_time < ($${params.length}::date + INTERVAL '1 day')`);
  }

  const result = await db.query(
    `
    SELECT
      te.id,
      te.projet_id,
      p.nom AS projet_nom,
      c.id AS client_id,
      c.nom AS client_nom,
      te.description,
      te.start_time,
      te.end_time,
      p.billing_increment,
      p.billing_rounding_type,
      ROUND(COALESCE(te.hourly_rate_used, p.taux_horaire, c.hourly_rate_defaut, 0), 2) AS hourly_rate_used
    FROM time_entries te
    JOIN projets p
      ON p.id = te.projet_id
     AND p.organisation_id = te.organisation_id
    JOIN clients c
      ON c.id = p.client_id
     AND c.organisation_id = te.organisation_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY te.start_time ASC, te.id ASC
    `,
    params,
  );

  const entries = result.rows.map((row) => {
    const hours = Math.round(calculateEntryHours(row) * 100) / 100;
    const hourlyRate = roundMoney(calculateEntryRate(row));
    const amount = roundMoney(hours * hourlyRate);
    return {
      ...row,
      hours,
      hourly_rate_used: hourlyRate,
      amount,
    };
  });

  const normalizedTaxRate = normalizeTaxRate(taxRate);
  const subtotal = roundMoney(entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
  const taxTotal = roundMoney((subtotal * normalizedTaxRate) / 100);

  return {
    entries,
    summary: {
      entry_count: entries.length,
      total_hours: Math.round(entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0) * 100) / 100,
      subtotal,
      tax_rate: normalizedTaxRate,
      tax_total: taxTotal,
      total: roundMoney(subtotal + taxTotal),
      currency: "CAD",
    },
    filters: {
      client_id: Number(clientId),
      project_id: projectId ? Number(projectId) : null,
      from: from || null,
      to: to || null,
    },
  };
}

module.exports = {
  getTimeBillingPreview,
  normalizeTaxRate,
};
