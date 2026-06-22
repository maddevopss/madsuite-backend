const db = require("../../db");

/**
 * Single source of truth pour le calcul des métriques financières d'une organisation.
 */
async function computeMetrics(organisationId, context = {}) {
  const revenueQuery = `
    SELECT 
      COALESCE(SUM(total), 0) AS revenue_du_mois,
      COUNT(id) AS paiements_recus
    FROM invoices
    WHERE organisation_id = $1 
      AND status = 'paid'
      AND updated_at >= date_trunc('month', CURRENT_DATE)
      AND deleted_at IS NULL
  `;

  const dueQuery = `
    SELECT 
      COALESCE(SUM(CASE WHEN due_date >= CURRENT_DATE THEN total ELSE 0 END), 0) AS factures_dues,
      COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE THEN total ELSE 0 END), 0) AS factures_en_retard
    FROM invoices
    WHERE organisation_id = $1 
      AND status IN ('sent', 'draft')
      AND deleted_at IS NULL
  `;

  const mrrQuery = `
    SELECT 
      COUNT(r.id) AS recurring_count,
      COALESCE(SUM(i.total), 0) AS mrr_estime
    FROM recurring_invoices r
    JOIN invoices i ON r.template_invoice_id = i.id
    WHERE r.organisation_id = $1
  `;

  const [revenueRes, dueRes, mrrRes] = await Promise.all([
    db.query(revenueQuery, [organisationId]),
    db.query(dueQuery, [organisationId]),
    db.query(mrrQuery, [organisationId])
  ]);

  return {
    revenueDuMois: parseFloat(revenueRes.rows[0].revenue_du_mois),
    paiementsRecus: parseInt(revenueRes.rows[0].paiements_recus, 10),
    facturesDues: parseFloat(dueRes.rows[0].factures_dues),
    facturesEnRetard: parseFloat(dueRes.rows[0].factures_en_retard),
    mrrEstime: parseFloat(mrrRes.rows[0].mrr_estime),
    recurringCount: parseInt(mrrRes.rows[0].recurring_count, 10)
  };
}

module.exports = {
  computeMetrics
};
