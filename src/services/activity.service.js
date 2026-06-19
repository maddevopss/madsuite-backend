const db = require("../../db");
const { getActivityLogRetentionDays } = require("../config/activityRetention");
const { hasColumn } = require("../utils/dbSchema");
const { organisationValue } = require("../utils/organisationScope");
const { classifyApp } = require("./activityClassifier");
const { sanitizeAppName, sanitizeWindowTitle } = require("./activitySanitizer");

const MAX_BACKGROUND_WINDOWS = 25;

async function getActivityOrganisationCondition(params, organisationId, alias = "activity_logs") {
  const hasOrganisationId = await hasColumn("activity_logs", "organisation_id");

  if (!hasOrganisationId) return "";

  params.push(organisationValue(organisationId));
  return `AND ${alias}.organisation_id = $${params.length}`;
}

async function pruneOldActivityLogs(userId, organisationId) {
  const params = [userId, getActivityLogRetentionDays()];
  const organisationCondition = await getActivityOrganisationCondition(params, organisationId);

  await db.query(
    `DELETE FROM activity_logs
     WHERE utilisateur_id = $1
       AND captured_at < NOW() - ($2::int * INTERVAL '1 day')
       ${organisationCondition}`,
    params,
  );
}

async function insertActivityLog({
  utilisateurId,
  organisationId,
  appName,
  windowTitle,
  durationSeconds,
  isIdle = false,
  idleSeconds = 0,
  activitySignature = null,
  type = "active",
  includeCapturedAt = true,
}) {
  // Sécurité : on ignore les activités sans durée ou sans nom d'app
  if (!durationSeconds || durationSeconds <= 0 || !appName) {
    return null;
  }

  const hasOrganisationId = await hasColumn("activity_logs", "organisation_id");

  const columns = [
    "utilisateur_id",
    "app_name",
    "window_title",
    "duration_seconds",
    "is_idle",
    "idle_seconds",
    "activity_signature",
    "type",
  ];

  const values = [
    utilisateurId,
    sanitizeAppName(appName),
    sanitizeWindowTitle(windowTitle),
    durationSeconds,
    isIdle,
    idleSeconds,
    activitySignature,
    type,
  ];

  if (includeCapturedAt) {
    columns.splice(4, 0, "captured_at");
    values.splice(4, 0, new Date());
  }

  if (hasOrganisationId) {
    columns.push("organisation_id");
    values.push(organisationValue(organisationId));
  }

  const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");

  const result = await db.query(
    `INSERT INTO activity_logs (${columns.join(", ")})
     VALUES (${placeholders})
     RETURNING *`,
    values,
  );

  return result.rows[0];
}

async function createActiveLog({ userId, organisationId, data }) {
  const activity = await insertActivityLog({
    utilisateurId: userId,
    organisationId,
    appName: data.app_name,
    windowTitle: data.window_title,
    durationSeconds: data.duration_seconds,
    isIdle: data.is_idle,
    idleSeconds: data.idle_seconds,
    activitySignature: data.activity_signature,
    type: "active",
    includeCapturedAt: true,
  });

  await pruneOldActivityLogs(userId, organisationId);

  return activity;
}

async function createBatchActiveLogs({ userId, organisationId, logs }) {
  if (!Array.isArray(logs) || logs.length === 0) return 0;

  const hasOrganisationId = await hasColumn("activity_logs", "organisation_id");

  try {
    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    logs.forEach((log) => {
      // Validation de sécurité identique à insertActivityLog
      if (!log.duration_seconds || log.duration_seconds <= 0 || !log.app_name) {
        return;
      }

      const row = [
        userId,
        sanitizeAppName(log.app_name),
        sanitizeWindowTitle(log.window_title),
        log.duration_seconds,
        new Date(), // captured_at
        log.is_idle || false,
        log.idle_seconds || 0,
        log.activity_signature || null,
        "active",
      ];

      if (hasOrganisationId) row.push(organisationValue(organisationId));

      const rowPlaceholders = row.map(() => `$${paramIndex++}`);
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
      values.push(...row);
    });

    if (values.length === 0) {
      return 0;
    }

    const columns = [
      "utilisateur_id",
      "app_name",
      "window_title",
      "duration_seconds",
      "captured_at",
      "is_idle",
      "idle_seconds",
      "activity_signature",
      "type",
    ];
    if (hasOrganisationId) columns.push("organisation_id");

    const query = `INSERT INTO activity_logs (${columns.join(", ")}) VALUES ${placeholders.join(", ")} RETURNING id`;
    const result = await db.query(query, values);
    const insertedCount = result.rowCount;

    // On passe le client de transaction pour la purge
    await pruneOldActivityLogs(userId, organisationId);
    return insertedCount;
  } catch (error) {
    throw error;
  }
}

async function createBackgroundWindowLogs({ userId, organisationId, data }) {
  const { windows, duration_seconds, is_idle = false, idle_seconds = 0 } = data;
  const safeWindows = windows.slice(0, MAX_BACKGROUND_WINDOWS);

  for (const win of safeWindows) {
    await insertActivityLog({
      utilisateurId: userId,
      organisationId,
      appName: win.ProcessName || win.name || "Unknown",
      windowTitle: win.MainWindowTitle || win.title || "",
      durationSeconds: duration_seconds,
      isIdle: is_idle,
      idleSeconds: idle_seconds,
      activitySignature: null,
      type: "background",
      includeCapturedAt: true,
    });
  }

  await pruneOldActivityLogs(userId, organisationId);

  return safeWindows.length;
}

async function listRecentActiveLogs({ userId, organisationId }) {
  const params = [userId];
  const organisationCondition = await getActivityOrganisationCondition(params, organisationId);

  const result = await db.query(
    `SELECT id, app_name, window_title, duration_seconds,
            is_idle, idle_seconds, captured_at
     FROM activity_logs
     WHERE utilisateur_id = $1
       AND type = 'active'
       ${organisationCondition}
     ORDER BY captured_at DESC
     LIMIT 10`,
    params,
  );

  return result.rows;
}

async function getLatestActiveLog({ userId, organisationId }) {
  const params = [userId];
  const organisationCondition = await getActivityOrganisationCondition(params, organisationId);

  const result = await db.query(
    `SELECT *
     FROM activity_logs
     WHERE utilisateur_id = $1
       AND type = 'active'
       ${organisationCondition}
     ORDER BY captured_at DESC
     LIMIT 1`,
    params,
  );

  return result.rows[0] || null;
}

async function getDailySummary({ userId, organisationId, dateDebut, dateFin }) {
  const hasSummaryOrganisationId = await hasColumn("activity_daily_summary", "organisation_id");
  const params = [userId, dateDebut, dateFin];
  let organisationFilter = "";
  let organisationJoin = "";

  if (hasSummaryOrganisationId) {
    params.push(organisationValue(organisationId));
    organisationFilter = `AND ads.organisation_id = $${params.length}`;
  } else {
    params.push(organisationValue(organisationId));
    organisationJoin = `INNER JOIN utilisateurs u
      ON u.id = ads.utilisateur_id
      AND u.organisation_id = $${params.length}`;
  }

  const result = await db.query(
    `
    SELECT
      ads.app_name,
      SUM(ads.total_seconds) AS total_seconds
    FROM activity_daily_summary ads
    ${organisationJoin}
    WHERE ads.utilisateur_id = $1
      AND ads.activity_date >= $2
      AND ads.activity_date <= $3
      ${organisationFilter}
    GROUP BY ads.app_name
    ORDER BY total_seconds DESC
    `,
    params,
  );

  return result.rows.map((row) => ({
    app_name: row.app_name || "Inconnu",
    total_seconds: Number(row.total_seconds || 0),
    category: classifyApp(row.app_name),
  }));
}

async function updateActivityDuration({ activityId, userId, organisationId, data }) {
  const params = [data.duration_seconds, data.is_idle, data.idle_seconds, activityId, userId];
  const organisationCondition = await getActivityOrganisationCondition(params, organisationId);

  const result = await db.query(
    `UPDATE activity_logs
     SET duration_seconds = COALESCE(duration_seconds, 0) + $1,
         is_idle = $2,
         idle_seconds = $3,
         captured_at = CURRENT_TIMESTAMP
     WHERE id = $4
       AND utilisateur_id = $5
       ${organisationCondition}
     RETURNING *`,
    params,
  );

  return result.rows[0] || null;
}

async function deleteUserActivityHistory({ userId, organisationId }) {
  const params = [userId];
  const organisationCondition = await getActivityOrganisationCondition(params, organisationId);

  try {
    const logsResult = await db.query(
      `
      DELETE FROM activity_logs
      WHERE utilisateur_id = $1
        ${organisationCondition}
      `,
      params,
    );
    const summariesResult = await db.query(
      `
      DELETE FROM activity_daily_summary
      WHERE utilisateur_id = $1
        AND organisation_id = $2
      `,
      [userId, organisationId],
    );

    return logsResult.rowCount + summariesResult.rowCount;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  MAX_BACKGROUND_WINDOWS,
  createActiveLog,
  createBackgroundWindowLogs,
  deleteUserActivityHistory,
  getDailySummary,
  getLatestActiveLog,
  listRecentActiveLogs,
  updateActivityDuration,
};
