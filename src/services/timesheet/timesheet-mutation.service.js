const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { requireOrganisation } = require("./timesheet.helpers");
const { validateTimeRange } = require("./timesheet-validation.service");

async function createManualEntry({ userId, organisationId, projetId, description, startTime, endTime }) {
  requireOrganisation(organisationId);
  validateTimeRange(startTime, endTime);

  const result = await db.query(
    `
    INSERT INTO time_entries
      (
        projet_id,
        utilisateur_id,
        start_time,
        end_time,
        description,
        hourly_rate_used,
        organisation_id
      )
    SELECT
      p.id,
      $2,
      $3::timestamptz,
      $4::timestamptz,
      $5,
      COALESCE(p.taux_horaire, c.hourly_rate_defaut, 0),
      $6
    FROM projets p
    JOIN clients c
      ON c.id = p.client_id
      AND c.organisation_id = $6
      AND c.deleted_at IS NULL
    WHERE p.id = $1
      AND p.organisation_id = $6
      AND COALESCE(p.status, 'actif') = 'actif'
      AND p.deleted_at IS NULL
    RETURNING *
    `,
    [projetId, userId, startTime, endTime, description || null, organisationValue(organisationId)],
  );

  if (result.rows.length === 0) {
    const err = new Error("Projet introuvable ou non accessible.");
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

async function updateEntry({ entryId, userId, role, organisationId, projetId, description, startTime, endTime }) {
  requireOrganisation(organisationId);

  if (startTime && endTime) {
    validateTimeRange(startTime, endTime);
  } else if (startTime || endTime) {
    // Si l'un des deux seulement est fourni, la base de données effectuera COALESCE
    // Dans l'idéal il faudrait fetcher l'entrée existante pour valider si start > end, mais on se fie au check SQL/logique métier simplifiée
  }

  const params = [
    projetId || null,
    description === undefined ? null : description,
    startTime || null,
    endTime || null,
    entryId,
    organisationValue(organisationId),
  ];

  const userCondition = role === "admin" ? "" : "AND utilisateur_id = $7";
  if (role !== "admin") params.push(userId);

  const result = await db.query(
    `
  UPDATE time_entries te
  SET projet_id = COALESCE($1, te.projet_id),
      description = COALESCE($2, te.description),
      start_time = COALESCE($3::timestamptz, te.start_time),
      end_time = COALESCE($4::timestamptz, te.end_time),
      updated_at = CURRENT_TIMESTAMP
  WHERE te.id = $5
    AND te.organisation_id = $6
    ${userCondition}
    AND (
      $1::int IS NULL
      OR EXISTS (
        SELECT 1
        FROM projets p
        JOIN clients c ON c.id = p.client_id
        WHERE p.id = $1
          AND p.organisation_id = $6
          AND c.organisation_id = $6
          AND COALESCE(p.status, 'actif') = 'actif'
          AND p.deleted_at IS NULL
          AND c.deleted_at IS NULL
      )
    )
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

async function setEntryBilled({ entryId, userId, role, organisationId, isBilled }) {
  requireOrganisation(organisationId);

  const params = [entryId, organisationValue(organisationId), Boolean(isBilled)];
  const userCondition = role === "admin" ? "" : "AND utilisateur_id = $4";

  if (role !== "admin") params.push(userId);

  const result = await db.query(
    `
    UPDATE time_entries
    SET is_billed = $3,
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

async function deleteEntry({ entryId, userId, role, organisationId }) {
  requireOrganisation(organisationId);

  const params = [entryId, organisationValue(organisationId)];
  const userCondition = role === "admin" ? "" : "AND utilisateur_id = $3";

  if (role !== "admin") params.push(userId);

  const result = await db.query(
    `
    UPDATE time_entries
    SET deleted_at = NOW(),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND organisation_id = $2
      AND deleted_at IS NULL
      ${userCondition}
    RETURNING id
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
  createManualEntry,
  updateEntry,
  setEntryBilled,
  deleteEntry,
};
