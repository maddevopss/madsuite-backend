const db = require("../../db");
const { hasColumn } = require("../utils/dbSchema");
const { organisationScope, getTimezone, organisationValue } = require("../utils/organisationScope");

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

async function generateReport({ userId, role, organisationId, dateDebut, dateFin, isBilled, groupBy }) {
  const isAdmin = role === "admin";
  const tz = await getTimezone(organisationId);
  const params = [dateDebut, dateFin, tz];
  let userCondition = "";

  if (!isAdmin) {
    params.push(userId);
    userCondition = `AND te.utilisateur_id = $${params.length}`;
  }

  let billedCondition = "";
  if (isBilled === "true") {
    params.push(true);
    billedCondition = `AND te.is_billed = $${params.length}`;
  } else if (isBilled === "false") {
    params.push(false);
    billedCondition = `AND te.is_billed = $${params.length}`;
  }

  let groupByClause = "c.id, c.nom, p.id, p.nom, u.id, u.nom";
  let selectPeriod = "";

  if (groupBy === "month") {
    selectPeriod = `,
      TO_CHAR(DATE_TRUNC('month', te.start_time AT TIME ZONE $3), 'YYYY-MM') AS periode,
      TO_CHAR(DATE_TRUNC('month', te.start_time AT TIME ZONE $3), 'TMMonth YYYY') AS periode_label`;
    groupByClause = "c.id, c.nom, p.id, p.nom, u.id, u.nom, DATE_TRUNC('month', te.start_time AT TIME ZONE $3)";
  } else if (groupBy === "week") {
    selectPeriod = `,
      TO_CHAR(DATE_TRUNC('week', te.start_time AT TIME ZONE $3), 'YYYY-"W"IW') AS periode,
      TO_CHAR(DATE_TRUNC('week', te.start_time AT TIME ZONE $3), 'TMMonth DD, YYYY') AS periode_label`;
    groupByClause = "c.id, c.nom, p.id, p.nom, u.id, u.nom, DATE_TRUNC('week', te.start_time AT TIME ZONE $3)";
  }

  const projectOrgFilter = organisationScope("p", params, organisationId).replace(/^AND\s+/, "AND ");
  const clientOrgFilter = organisationScope("c", params, organisationId).replace(/^AND\s+/, "AND ");
  const userOrgFilter = organisationScope("u", params, organisationId).replace(/^AND\s+/, "AND ");
  const timeEntriesOrgFilter = organisationScope("te", params, organisationId).replace(/^AND\s+/, "AND ");

  const result = await db.query(
    `SELECT
       c.id AS client_id,
       c.nom AS client,
       p.id AS projet_id,
       p.nom AS projet,
       ROUND(AVG(COALESCE(te.hourly_rate_used, p.taux_horaire, c.hourly_rate_defaut, 0)), 2) AS taux_horaire,
       u.id AS utilisateur_id,
       u.nom AS utilisateur,
       COUNT(te.id) AS entrees,
       MIN(te.start_time) AS premiere_entree,
       MAX(te.end_time) AS derniere_entree,
       ROUND(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600), 2) AS heures,
       ROUND(SUM(
         CASE WHEN COALESCE(te.hourly_rate_used, p.taux_horaire, c.hourly_rate_defaut, 0) > 0
           THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600
           ELSE 0 END
       ), 2) AS heures_facturables,
       ROUND(SUM(
         CASE WHEN COALESCE(te.hourly_rate_used, p.taux_horaire, c.hourly_rate_defaut, 0) > 0
           THEN (EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600)
                * COALESCE(te.hourly_rate_used, p.taux_horaire, c.hourly_rate_defaut, 0)
           ELSE 0 END
       ), 2) AS montant_estime,
       ROUND(SUM(
         CASE WHEN te.is_billed = true
           THEN (EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600)
                * COALESCE(te.hourly_rate_used, p.taux_horaire, c.hourly_rate_defaut, 0)
           ELSE 0 END
       ), 2) AS montant_facture
       ${selectPeriod}
     FROM time_entries te
     JOIN projets p ON p.id = te.projet_id
       AND p.deleted_at IS NULL
       ${projectOrgFilter}
     JOIN clients c ON c.id = p.client_id
       AND c.deleted_at IS NULL
       ${clientOrgFilter}
     JOIN utilisateurs u ON u.id = te.utilisateur_id
       ${userOrgFilter}
     WHERE (te.start_time AT TIME ZONE $3)::date >= $1::date
       AND (te.start_time AT TIME ZONE $3)::date <= $2::date
       AND te.end_time IS NOT NULL
       AND te.deleted_at IS NULL
       ${timeEntriesOrgFilter}
       ${billedCondition}
       ${userCondition}
     GROUP BY ${groupByClause}
     ORDER BY c.nom ASC, p.nom ASC, montant_estime DESC`,
    params,
  );

  const rows = result.rows;
  const total = rows.reduce(
    (acc, row) => {
      acc.heures += Number(row.heures || 0);
      acc.heures_facturables += Number(row.heures_facturables || 0);
      acc.montant_estime += Number(row.montant_estime || 0);
      acc.montant_facture += Number(row.montant_facture || 0);
      return acc;
    },
    { heures: 0, heures_facturables: 0, montant_estime: 0, montant_facture: 0 },
  );

  return { rows, total };
}

async function listDebugTimeEntries({ organisationId }) {
  const params = [organisationValue(organisationId)];

  const result = await db.query(
    `
    SELECT *
    FROM time_entries
    WHERE organisation_id = $1
      AND deleted_at IS NULL
    LIMIT 10
    `,
    params,
  );

  return result.rows;
}

async function listDebugActivityLogs({ organisationId, userId, type }) {
  const params = [type];
  const conditions = ["type = $1"];

  if (await hasColumn("activity_logs", "organisation_id")) {
    conditions.push(`organisation_id = ${addParam(params, organisationValue(organisationId))}`);
  } else {
    conditions.push(`utilisateur_id = ${addParam(params, userId)}`);
  }

  const result = await db.query(
    `
    SELECT *
    FROM activity_logs
    WHERE ${conditions.join(" AND ")}
    LIMIT 10
    `,
    params,
  );

  return result.rows;
}

module.exports = {
  generateReport,
  listDebugTimeEntries,
  listDebugActivityLogs,
};
