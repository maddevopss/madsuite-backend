const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");

function validateTimeRange(startTime, endTime) {
  if (!startTime || !endTime || new Date(endTime) <= new Date(startTime)) {
    const err = new Error("Plage horaire invalide.");
    err.statusCode = 400;
    throw err;
  }
}

async function validateProjectAccess(projetId, organisationId, client = db) {
  const result = await client.query(
    `
    SELECT 1
    FROM projets p
    JOIN clients c ON c.id = p.client_id
    WHERE p.id = $1
      AND p.organisation_id = $2
      AND c.organisation_id = $2
      AND COALESCE(p.status, 'actif') = 'actif'
      AND p.deleted_at IS NULL
      AND c.deleted_at IS NULL
    `,
    [projetId, organisationValue(organisationId)]
  );

  return result.rows.length > 0;
}

module.exports = {
  validateTimeRange,
  validateProjectAccess,
};
