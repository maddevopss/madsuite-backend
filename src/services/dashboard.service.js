const db = require("../../db");
const { classifyActivities } = require("./activityIntelligence.service");

async function listClientDashboard({ userId, role, organisationId }) {
  const isAdmin = role === "admin";
  const params = [organisationId];
  let userJoinCondition = "";

  if (!isAdmin) {
    params.push(userId);
    userJoinCondition = "AND t.utilisateur_id = $2";
  }

  const result = await db.query(
    `SELECT
       c.id,
       c.nom,
       c.hourly_rate_defaut,
       COUNT(DISTINCT p.id) AS projets_total,
       COALESCE(
         SUM(EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600),
         0
       ) AS heures_total
     FROM clients c
     LEFT JOIN projets p
       ON p.client_id = c.id
       AND p.organisation_id = c.organisation_id
       AND p.deleted_at IS NULL
     LEFT JOIN time_entries t
       ON t.projet_id = p.id
       AND t.end_time IS NOT NULL
       ${userJoinCondition}
     WHERE c.organisation_id = $1
       AND c.deleted_at IS NULL
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    params,
  );

  return result.rows;
}

async function getActivitySummary({ userId, organisationId, dateDebut, dateFin }) {
  const result = await db.query(
    `
    SELECT
      ads.app_name,
      SUM(ads.total_seconds) AS total_seconds
    FROM activity_daily_summary ads
    INNER JOIN utilisateurs u
      ON u.id = ads.utilisateur_id
    WHERE ads.utilisateur_id = $1
      AND u.organisation_id = $2
      AND u.deleted_at IS NULL
      AND ads.activity_date >= $3
      AND ads.activity_date <= $4
    GROUP BY ads.app_name
    ORDER BY total_seconds DESC
    `,
    [userId, organisationId, dateDebut, dateFin],
  );

  const classifications = await classifyActivities(organisationId, result.rows);

  return result.rows.map((row, index) => {
    const classification = classifications[index];
    const category =
      classification.source === "fallback" ? "neutre" : classification.is_productive ? "productif" : "distraction";

    return {
      app_name: row.app_name || "Inconnu",
      total_seconds: Number(row.total_seconds || 0),
      category,
      activity_category: classification.category,
      classification_source: classification.source,
    };
  });
}

module.exports = {
  listClientDashboard,
  getActivitySummary,
};
