const db = require("../../db");

async function notifyOrganisationAdmins({ organisationId, type, message }) {
  if (!organisationId || !type || !message) return 0;

  const result = await db.query(
    `INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
     SELECT organisation_id, id, $2, $3
     FROM utilisateurs
     WHERE organisation_id = $1
       AND role = 'admin'
       AND deleted_at IS NULL`,
    [organisationId, type, message],
  );

  return result.rowCount || 0;
}

async function notifyAllOrganisationAdmins({ type, message }) {
  if (!type || !message) return 0;

  const result = await db.query(
    `INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
     SELECT organisation_id, id, $1, $2
     FROM utilisateurs
     WHERE role = 'admin'
       AND organisation_id IS NOT NULL
       AND deleted_at IS NULL`,
    [type, message],
  );

  return result.rowCount || 0;
}

module.exports = {
  notifyOrganisationAdmins,
  notifyAllOrganisationAdmins,
};
