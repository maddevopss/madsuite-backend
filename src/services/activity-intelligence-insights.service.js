const db = require("../../db");
const { classifyActivity } = require("./activity-intelligence-engine.service");

const missingActivityTables = (err) => err.code === "42P01" || err.code === "42703";

async function getInsights({ userId, role }) {
  const params = [];
  const conditions = [];

  if (role !== "admin") {
    params.push(userId);
    conditions.push(`utilisateur_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.query(
    `
    SELECT
      app_name,
      COALESCE(activity_category, 'Non classé') AS activity_category,
      COUNT(*) AS occurrences,
      COALESCE(SUM(duration_seconds), 0) AS total_seconds,
      ROUND(AVG(COALESCE(confidence_score, 0))) AS avg_confidence
    FROM activity_logs
    ${where}
    GROUP BY app_name, COALESCE(activity_category, 'Non classé')
    ORDER BY total_seconds DESC
    LIMIT 20
    `,
    params,
  );

  return result.rows || [];
}

async function getActivityLogForAnalysis({ activityLogId, userId, role, organisationId }) {
  const params = [activityLogId];
  const conditions = ["id = $1"];

  if (role !== "admin") {
    params.push(userId);
    conditions.push(`utilisateur_id = $${params.length}`);
  }

  if (organisationId) {
    params.push(organisationId);
    conditions.push(`organisation_id = $${params.length}`);
  }

  const result = await db.query(
    `
    SELECT *
    FROM activity_logs
    WHERE ${conditions.join(" AND ")}
    LIMIT 1
    `,
    params,
  );

  return result.rows[0] || null;
}

async function updateActivityClassification({ activityLogId, category, confidence, organisationId }) {
  const params = [category, confidence, activityLogId];
  const conditions = ["id = $3"];

  if (organisationId) {
    params.push(organisationId);
    conditions.push(`organisation_id = $${params.length}`);
  }

  await db.query(
    `
    UPDATE activity_logs
    SET activity_category = $1,
        confidence_score = $2
    WHERE ${conditions.join(" AND ")}
    `,
    params,
  );
}

async function analyzeActivityLog({ organisationId, activityLogId, userId, role }) {
  const log = await getActivityLogForAnalysis({
    activityLogId,
    userId,
    role,
    organisationId,
  });

  if (!log) {
    const err = new Error("Activité introuvable.");
    err.statusCode = 404;
    throw err;
  }

  const classification = await classifyActivity(organisationId, log);

  await updateActivityClassification({
    activityLogId,
    category: classification.category,
    confidence: classification.confidence,
    organisationId,
  });

  return {
    activityLogId,
    ...classification,
  };
}

module.exports = {
  missingActivityTables,
  getInsights,
  analyzeActivityLog,
};
