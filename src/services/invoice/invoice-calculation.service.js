const db = require("../../../db");
const { organisationScope } = require("../../utils/organisationScope");

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

function calculateTotals(entries, expenses, taxRatePercentage = 0) {
  let subtotal = 0;

  for (const entry of entries) {
    const hours = calculateEntryHours(entry);
    const rate = calculateEntryRate(entry);
    subtotal += roundMoney(hours * rate);
  }

  for (const exp of expenses) {
    subtotal += roundMoney(exp.montant);
  }

  const taxTotal = roundMoney(subtotal * (Number(taxRatePercentage) / 100));
  const total = roundMoney(subtotal + taxTotal);

  return {
    subtotal: roundMoney(subtotal),
    taxTotal,
    total,
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

async function fetchValidExpenses({ requestedExpenseIds, clientId, organisationId, lock = false, client = db }) {
  if (!requestedExpenseIds || requestedExpenseIds.length === 0) return [];

  const params = [requestedExpenseIds, clientId];
  const orgFilter = scopedOrganisationFilter("e", params, organisationId);

  const result = await client.query(
    `
    SELECT e.*, p.nom AS projet_nom
    FROM expenses e
    JOIN projets p ON p.id = e.projet_id
    WHERE e.id = ANY($1)
      AND p.client_id = $2
      AND e.is_billed = FALSE
      AND e.invoice_id IS NULL
      AND e.deleted_at IS NULL
      ${orgFilter}
    ORDER BY e.date_depense ASC
    ${lock ? "FOR UPDATE OF e" : ""}
    `,
    params,
  );

  return result.rows;
}

module.exports = {
  scopedOrganisationFilter,
  roundMoney,
  calculateEntryHours,
  calculateEntryRate,
  calculateTotals,
  fetchValidEntries,
  fetchValidExpenses,
};
