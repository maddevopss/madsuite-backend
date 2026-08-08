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

  // Cette alerte est transversale: aucun contexte d'organisation n'existe au
  // démarrage. La fonction SQL SECURITY DEFINER applique l'écriture sans
  // contourner le rôle applicatif ni le RLS des requêtes ordinaires.
  if (type === "system_alert") {
    const result = await db.query(
      "SELECT notify_all_admins_system_alert($1) AS count",
      [message],
    );
    return Number(result.rows[0]?.count || 0);
  }

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
