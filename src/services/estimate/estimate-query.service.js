const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");

/**
 * Liste les soumissions pour l'organisation courante.
 */
async function listEstimates({ organisationId, status, clientId }) {
  let query = `
    SELECT e.*, c.nom as client_nom 
    FROM estimates e
    JOIN clients c ON e.client_id = c.id
    WHERE e.organisation_id = $1 AND e.deleted_at IS NULL
  `;
  const values = [organisationValue(organisationId)];

  if (status) {
    query += ` AND e.status = $${values.length + 1}`;
    values.push(status);
  }
  if (clientId) {
    query += ` AND e.client_id = $${values.length + 1}`;
    values.push(clientId);
  }

  query += " ORDER BY e.created_at DESC";

  const res = await db.query(query, values);
  return res.rows;
}

/**
 * Récupère une soumission avec ses items.
 */
async function getEstimateById(estimateId, organisationId) {
  const estimateRes = await db.query(
    `SELECT e.*, c.nom as client_nom, c.email as client_email 
     FROM estimates e
     JOIN clients c ON e.client_id = c.id
     WHERE e.id = $1 AND e.organisation_id = $2 AND e.deleted_at IS NULL`,
    [estimateId, organisationValue(organisationId)]
  );

  if (estimateRes.rows.length === 0) return null;
  const estimate = estimateRes.rows[0];

  const itemsRes = await db.query(
    `SELECT * FROM estimate_items WHERE estimate_id = $1 AND organisation_id = $2 ORDER BY id ASC`,
    [estimateId, organisationValue(organisationId)]
  );

  estimate.items = itemsRes.rows;
  return estimate;
}

module.exports = {
  listEstimates,
  getEstimateById
};
