const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { requireOrganisation } = require("./timesheet.helpers");

async function setEntryStatus({ entryId, userId, role, organisationId, status }) {
  requireOrganisation(organisationId);

  const params = [entryId, organisationValue(organisationId), status];
  const userCondition = role === "admin" ? "" : "AND utilisateur_id = $4";

  if (role !== "admin") params.push(userId);

  const result = await db.query(
    `
    UPDATE time_entries
    SET status = $3,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND organisation_id = $2
      ${userCondition}
    RETURNING *
    `,
    params,
  );

  if (result.rows.length === 0) {
    const err = new Error("Entrée introuvable ou non accessible.");
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  setEntryStatus,
};
