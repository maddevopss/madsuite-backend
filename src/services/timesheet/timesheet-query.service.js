const db = require("../../../db");
const { organisationValue, getTimezone } = require("../../utils/organisationScope");
const { addDateRangeFilter, normalizePagination } = require("../../utils/queryFilters");
const { addParam, getDeletedFilters, requireOrganisation } = require("./timesheet.helpers");

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
  const timezone = await getTimezone(organisationId);
  const params = [organisationValue(organisationId), timezone];
  const timezoneParam = "$2::text";
  const conditions = ["te.organisation_id = $1", "te.end_time IS NOT NULL"];
  const { page: safePage, limit: safeLimit, offset } = normalizePagination({ page, limit });

  addDateRangeFilter({
    conditions,
    params,
    column: "te.start_time",
    dateDebut,
    dateFin,
    timezoneParam,
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
    SELECT 
      COUNT(*)::int AS total,
      COALESCE(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time))), 0) AS total_seconds,
      COALESCE(SUM(CASE WHEN te.is_billed = TRUE THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time)) ELSE 0 END), 0) AS facturable_seconds,
      COUNT(DISTINCT te.projet_id)::int AS projets_total,
      COALESCE(SUM((EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600) * COALESCE(te.hourly_rate_used, p.taux_horaire, c.hourly_rate_defaut, 0)), 0) AS montant,
      
      COALESCE(SUM(CASE WHEN date_trunc('day', te.start_time AT TIME ZONE $2::text) = date_trunc('day', NOW() AT TIME ZONE $2::text) THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time)) ELSE 0 END), 0) AS today_total_seconds,
      COALESCE(SUM(CASE WHEN date_trunc('day', te.start_time AT TIME ZONE $2::text) = date_trunc('day', NOW() AT TIME ZONE $2::text) AND te.is_billed = TRUE THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time)) ELSE 0 END), 0) AS today_facturable_seconds,
      COUNT(DISTINCT CASE WHEN date_trunc('day', te.start_time AT TIME ZONE $2::text) = date_trunc('day', NOW() AT TIME ZONE $2::text) THEN te.projet_id END)::int AS today_projets_total
    ${fromClause}
    `,
    params,
  );

  const statsRow = countResult.rows[0] || {};
  const total = Number(statsRow.total || 0);
  const paginatedParams = [...params, safeLimit, offset];
  const limitParam = paginatedParams.length - 1;
  const offsetParam = paginatedParams.length;

  const result = await db.query(
    `
    SELECT
      $2::text AS _ignored_timezone,
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
    stats: {
      today: {
        totalSeconds: Number(statsRow.today_total_seconds || 0),
        facturableSeconds: Number(statsRow.today_facturable_seconds || 0),
        projetsTotal: Number(statsRow.today_projets_total || 0),
      },
      week: {
        totalSeconds: Number(statsRow.total_seconds || 0),
        facturableSeconds: Number(statsRow.facturable_seconds || 0),
        projetsTotal: Number(statsRow.projets_total || 0),
        montant: Number(statsRow.montant || 0),
      }
    },
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

module.exports = {
  listProjects,
  listEntries,
};
