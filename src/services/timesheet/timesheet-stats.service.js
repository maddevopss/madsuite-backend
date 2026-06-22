const db = require("../../../db");
const { organisationValue, getTimezone } = require("../../utils/organisationScope");
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

module.exports = {
  getDashboardStats,
};
