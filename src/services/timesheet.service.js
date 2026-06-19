const db = require("../../db");

const { organisationValue, getTimezone } = require("../utils/organisationScope");
const { addDateRangeFilter, normalizePagination } = require("../utils/queryFilters");
const { addParam, getDeletedFilters, requireOrganisation } = require("./timesheet.helpers");

async function getDashboardStats({ userId, role, organisationId }) {
  requireOrganisation(organisationId);

  const timezone = await getTimezone(organisationId);
  const isAdmin = role === "admin";
  const { clientFilter, projectFilter, timeEntryFilter } = await getDeletedFilters();

  const params = [organisationValue(organisationId)];
  const userFilter = isAdmin ? "" : `AND te.utilisateur_id = ${addParam(params, userId)}`;

  const result = await db.query(
    `
    WITH base AS (
      SELECT
        te.id,
        te.start_time,
        te.end_time,
        te.is_billed,
        te.hourly_rate_used,
        p.taux_horaire,
        c.hourly_rate_defaut,
        c.nom AS client_nom,
        (EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600) AS heures
      FROM time_entries te
      JOIN projets p
        ON p.id = te.projet_id
        AND p.organisation_id = $1
        ${projectFilter}
      JOIN clients c
        ON c.id = p.client_id
        AND c.organisation_id = $1
        ${clientFilter}
      WHERE te.organisation_id = $1
        AND te.end_time IS NOT NULL
        ${timeEntryFilter}
        ${userFilter}
    )
    SELECT
      COALESCE(SUM(CASE
        WHEN (start_time AT TIME ZONE $${params.length + 1})::date >= ((NOW() AT TIME ZONE $${params.length + 1})::date - INTERVAL '6 days')
        THEN heures ELSE 0 END), 0) AS semaine,
      COALESCE(SUM(CASE
        WHEN date_trunc('month', start_time AT TIME ZONE $${params.length + 1}) = date_trunc('month', NOW() AT TIME ZONE $${params.length + 1})
        THEN heures ELSE 0 END), 0) AS mois,
      COALESCE(
        ROUND(
          100.0 * SUM(CASE WHEN is_billed = TRUE THEN heures ELSE 0 END)
          / NULLIF(SUM(heures), 0)
        ),
        0
      ) AS pct_facturable,
      COALESCE(SUM(CASE
        WHEN is_billed = FALSE
        THEN heures * COALESCE(hourly_rate_used, taux_horaire, hourly_rate_defaut, 0)
        ELSE 0 END), 0) AS montant_a_facturer
    FROM base
    `,
    [...params, timezone],
  );

  const clientsResult = await db.query(
    `
    SELECT
      c.nom AS client,
      COALESCE(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600), 0) AS heures
    FROM time_entries te
    JOIN projets p
      ON p.id = te.projet_id
      AND p.organisation_id = $1
      ${projectFilter}
    JOIN clients c
      ON c.id = p.client_id
      AND c.organisation_id = $1
      ${clientFilter}
    WHERE te.organisation_id = $1
      AND te.end_time IS NOT NULL
      AND date_trunc('month', te.start_time AT TIME ZONE $2) = date_trunc('month', NOW() AT TIME ZONE $2)
      ${timeEntryFilter}
      ${isAdmin ? "" : "AND te.utilisateur_id = $3"}
    GROUP BY c.nom
    ORDER BY heures DESC
    LIMIT 10
    `,
    isAdmin ? [organisationValue(organisationId), timezone] : [organisationValue(organisationId), timezone, userId],
  );

  const daysResult = await db.query(
    `
    SELECT
      (te.start_time AT TIME ZONE $2)::date AS jour,
      COALESCE(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600), 0) AS heures
    FROM time_entries te
    JOIN projets p
      ON p.id = te.projet_id
      AND p.organisation_id = $1
      ${projectFilter}
    WHERE te.organisation_id = $1
      AND te.end_time IS NOT NULL
      AND (te.start_time AT TIME ZONE $2)::date >= ((NOW() AT TIME ZONE $2)::date - INTERVAL '6 days')
      ${timeEntryFilter}
      ${isAdmin ? "" : "AND te.utilisateur_id = $3"}
    GROUP BY jour
    ORDER BY jour ASC
    `,
    isAdmin ? [organisationValue(organisationId), timezone] : [organisationValue(organisationId), timezone, userId],
  );

  const stats = result.rows[0] || {};

  return {
    semaine: Number(stats.semaine || 0),
    mois: Number(stats.mois || 0),
    pct_facturable: Number(stats.pct_facturable || 0),
    montant_a_facturer: Number(stats.montant_a_facturer || 0),
    par_client: clientsResult.rows,
    par_jour: daysResult.rows,
  };
}

async function listProjects({ organisationId }) {
  requireOrganisation(organisationId);

  const result = await db.query(
    `
    SELECT
      p.id,
      p.nom,
      p.client_id,
      p.couleur,
      p.taux_horaire,
      c.nom AS client
    FROM projets p
    JOIN clients c
      ON c.id = p.client_id
      AND c.organisation_id = $1
      AND c.deleted_at IS NULL
    WHERE p.organisation_id = $1
      AND COALESCE(p.status, 'actif') = 'actif'
      AND p.deleted_at IS NULL
    ORDER BY c.nom ASC, p.nom ASC
    `,
    [organisationValue(organisationId)],
  );

  return result.rows;
}

/**
 * Lists finished time entries visible to a user with filters and pagination.
 *
 * Admin users can filter by utilisateur_id; non-admin users are always scoped
 * to their own entries. The returned shape is consumed directly by the
 * timesheet frontend hook.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {"admin"|"employe"|string} params.role
 * @param {number} params.organisationId
 * @param {string} [params.dateDebut]
 * @param {string} [params.dateFin]
 * @param {number} [params.clientId]
 * @param {"true"|"false"|""} [params.isBilled]
 * @param {number} [params.filterUserId]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=50]
 * @returns {Promise<{data: object[], pagination: {page: number, limit: number, total: number, totalPages: number, hasNext: boolean, hasPrev: boolean}}>}
 */
async function listEntries({
  userId,
  role,
  organisationId,
  dateDebut,
  dateFin,
  clientId,
  isBilled,
  filterUserId,
  page = 1,
  limit = 50,
}) {
  requireOrganisation(organisationId);

  const { clientFilter, projectFilter, timeEntryFilter } = await getDeletedFilters();
  const params = [organisationValue(organisationId)];
  const conditions = ["te.organisation_id = $1", "te.end_time IS NOT NULL"];
  const timezone = await getTimezone(organisationId);
  const { page: safePage, limit: safeLimit, offset } = normalizePagination({ page, limit });

  addDateRangeFilter({
    conditions,
    params,
    column: "te.start_time",
    dateDebut,
    dateFin,
    timezone,
  });

  if (clientId) {
    conditions.push(`c.id = ${addParam(params, Number(clientId))}`);
  }

  if (isBilled !== undefined && isBilled !== "") {
    conditions.push(`te.is_billed = ${addParam(params, String(isBilled) === "true")}`);
  }

  if (role === "admin" && filterUserId) {
    conditions.push(`te.utilisateur_id = ${addParam(params, Number(filterUserId))}`);
  }

  if (role !== "admin") {
    conditions.push(`te.utilisateur_id = ${addParam(params, userId)}`);
  }

  const fromClause = `
    FROM time_entries te
    JOIN projets p
      ON p.id = te.projet_id
      AND p.organisation_id = $1
      AND p.deleted_at IS NULL
    JOIN clients c
      ON c.id = p.client_id
      AND c.organisation_id = $1
      AND c.deleted_at IS NULL
    LEFT JOIN utilisateurs u
      ON u.id = te.utilisateur_id
      AND u.organisation_id = $1
    WHERE ${conditions.join(" AND ")}
      ${timeEntryFilter}
  `;

  const countResult = await db.query(
    `
    SELECT COUNT(*)::int AS total
    ${fromClause}
    `,
    params,
  );

  const total = Number(countResult.rows[0]?.total || 0);
  const paginatedParams = [...params, safeLimit, offset];
  const limitParam = paginatedParams.length - 1;
  const offsetParam = paginatedParams.length;

  const result = await db.query(
    `
    SELECT
      te.id,
      te.projet_id,
      te.utilisateur_id,
      te.description,
      te.start_time,
      te.end_time,
      te.is_billed,
      te.status,
      te.invoice_id,
      te.hourly_rate_used,
      p.nom AS projet,
      p.nom AS projet_nom,
      c.id AS client_id,
      c.nom AS client,
      c.nom AS client_nom,
      u.nom AS utilisateur_nom,
      ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600, 2) AS heures
    ${fromClause}
    ORDER BY te.start_time DESC, te.id DESC
    LIMIT $${limitParam}
    OFFSET $${offsetParam}
    `,
    paginatedParams,
  );

  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  return {
    data: result.rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    },
  };
}

async function createManualEntry({ userId, organisationId, projetId, description, startTime, endTime }) {
  requireOrganisation(organisationId);

  if (!startTime || !endTime || new Date(endTime) <= new Date(startTime)) {
    const err = new Error("Plage horaire invalide.");
    err.statusCode = 400;
    throw err;
  }

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

  if (startTime && endTime && new Date(endTime) <= new Date(startTime)) {
    const err = new Error("Plage horaire invalide.");
    err.statusCode = 400;
    throw err;
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

async function setEntryStatus({ entryId, userId, role, organisationId, status }) {
  requireOrganisation(organisationId);

  const params = [entryId, organisationValue(organisationId), status];
  // Admins can change anyone's status, others can only submit their own
  const userCondition = role === "admin" ? "" : "AND utilisateur_id = $4";

  if (role !== "admin") params.push(userId);

  // Validate transitions if necessary, or just update
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
  getDashboardStats,
  listProjects,
  listEntries,
  createManualEntry,
  updateEntry,
  setEntryBilled,
  deleteEntry,
  setEntryStatus,
};
