const db = require("../../db");
const { DEFAULT_RULES } = require("./activityIntelligence.defaults");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

function getOrganisationId(req) {
  return req.user?.organisation_id || null;
}

function appendOrganisationScope(params, organisationId, column = "organisation_id") {
  if (organisationId) {
    params.push(organisationId);
    return `(${column} = $${params.length} OR ${column} IS NULL)`;
  }

  return `${column} IS NULL`;
}

function ruleMatches(rule, appName = "", windowTitle = "") {
  const app = normalize(appName);
  const title = normalize(windowTitle);
  const appPattern = normalize(rule.app_pattern);
  const titlePattern = normalize(rule.title_pattern);

  if (!appPattern || !app.includes(appPattern)) return false;
  if (titlePattern && !title.includes(titlePattern)) return false;

  return true;
}

async function getCustomRules(organisationId) {
  try {
    const params = [];
    const conditions = ["active = TRUE", appendOrganisationScope(params, organisationId)];

    const result = await db.query(
      `
      SELECT id, app_pattern, title_pattern, category, tag, confidence, is_productive, priority, active
      FROM activity_app_rules

      WHERE ${conditions.join(" AND ")}
      ORDER BY priority DESC, confidence DESC, id DESC
      `,
      params,
    );

    return result.rows || [];
  } catch (err) {
    if (err.code === "42P01" || err.code === "42703") return [];
    throw err;
  }
}

function classifyWithRules(rules, appName = "", windowTitle = "") {
  const match = rules.find((rule) => ruleMatches(rule, appName, windowTitle));

  if (match) {
    return {
      category: match.category,
      tag: match.tag || null,
      confidence: Number(match.confidence ?? 70),
      is_productive: match.is_productive !== false,
      source: match.id ? "custom-rule" : "default-rule",
      rule_id: match.id || null,
    };
  }

  const text = normalize(`${appName} ${windowTitle}`);

  if (text.includes("localhost") || text.includes("github") || text.includes("jira") || text.includes("linear")) {
    return { category: "Développement", tag: "dev", confidence: 70, is_productive: true, source: "heuristic" };
  }

  return { category: "Autre", tag: "other", confidence: 30, is_productive: true, source: "fallback" };
}

async function classifyActivity(organisationId, appName = "", windowTitle = "") {
  const rules = [...(await getCustomRules(organisationId)), ...DEFAULT_RULES];
  return classifyWithRules(rules, appName, windowTitle);
}

async function classifyActivities(organisationId, activities = []) {
  const rules = [...(await getCustomRules(organisationId)), ...DEFAULT_RULES];
  return activities.map((activity) => classifyWithRules(rules, activity.app_name, activity.window_title));
}

function detectMultiAppContext(currentClassification, openWindows = []) {
  const text = openWindows
    .map((win) => `${win.app_name || win.ProcessName || ""} ${win.window_title || win.MainWindowTitle || ""}`)
    .join(" ")
    .toLowerCase();
  const hasCode = /code|visual studio|cursor|webstorm|intellij|pycharm|goland/.test(text);
  const hasTerminal = /terminal|powershell|cmd|bash|wsl/.test(text);
  const hasDevBrowser = /localhost|127\.0\.0\.1|github|gitlab|jira|linear|stackoverflow/.test(text);
  const hasMeeting = /teams|zoom|meet|slack/.test(text);
  const hasSpreadsheet = /excel|sheets/.test(text);

  if (hasCode && hasTerminal && hasDevBrowser) {
    return {
      ...currentClassification,
      category: "Développement",
      tag: "session-dev",
      confidence: Math.max(Number(currentClassification.confidence || 0), 92),
      context: "VS Code + Terminal + navigateur dev détectés",
    };
  }

  if (hasMeeting && hasSpreadsheet) {
    return {
      ...currentClassification,
      category: "Administration / Rencontre",
      tag: "meeting-admin",
      confidence: Math.max(Number(currentClassification.confidence || 0), 82),
      context: "Rencontre + tableur détectés",
    };
  }

  return {
    ...currentClassification,
    context: "Contexte simple",
  };
}

function buildFeedbackKeyword(windowTitle) {
  const keyword = String(windowTitle || "")
    .split(/[—\-|]/)[0]
    .trim()
    .slice(0, 255);

  return keyword.length >= 3 ? keyword : null;
}

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

  // Defense-in-depth: even for admins, when we have an organisationId context,
  // never allow a cross-organisation read/write by raw activityLogId.
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

  const classification = await classifyActivity(organisationId, log.app_name, log.window_title);

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

async function classifyCurrentContext({ organisationId, currentActivity, openWindows }) {
  const base = await classifyActivity(organisationId, currentActivity.app_name, currentActivity.window_title);

  return detectMultiAppContext(base, openWindows);
}

async function listRules({ organisationId }) {
  const params = [];
  const conditions = [appendOrganisationScope(params, organisationId)];

  const result = await db.query(
    `
    SELECT *
    FROM activity_app_rules
    WHERE ${conditions.join(" AND ")}
    ORDER BY active DESC, priority DESC, confidence DESC, id DESC
    `,
    params,
  );

  return result.rows || [];
}

async function createRule({ organisationId, userId, data }) {
  const result = await db.query(
    `
    INSERT INTO activity_app_rules
      (
        organisation_id,
        app_pattern,
        title_pattern,
        category,
        tag,
        confidence,
        is_productive,
        priority,
        active,
        created_by
      )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
    `,
    [
      organisationId,
      data.app_pattern,
      data.title_pattern || null,
      data.category,
      data.tag || null,
      data.confidence,
      data.is_productive,
      data.priority,
      data.active,
      userId,
    ],
  );

  return result.rows[0];
}

async function getRuleById({ ruleId, organisationId }) {
  const params = [ruleId];
  const conditions = ["id = $1"];

  conditions.push(appendOrganisationScope(params, organisationId));

  const result = await db.query(
    `
    SELECT *
    FROM activity_app_rules
    WHERE ${conditions.join(" AND ")}
    LIMIT 1
    `,
    params,
  );

  return result.rows[0] || null;
}

async function updateRule({ ruleId, organisationId, data }) {
  const current = await getRuleById({
    ruleId,
    organisationId,
  });

  if (!current) {
    const err = new Error("Règle introuvable.");
    err.statusCode = 404;
    throw err;
  }

  const nextData = {
    ...current,
    ...data,
  };

  const params = [
    nextData.app_pattern,
    nextData.title_pattern || null,
    nextData.category,
    nextData.tag || null,
    nextData.confidence,
    nextData.is_productive,
    nextData.priority,
    nextData.active,
    ruleId,
  ];

  const conditions = ["id = $9"];
  conditions.push(appendOrganisationScope(params, organisationId));

  const result = await db.query(
    `
    UPDATE activity_app_rules
    SET app_pattern = $1,
        title_pattern = $2,
        category = $3,
        tag = $4,
        confidence = $5,
        is_productive = $6,
        priority = $7,
        active = $8,
        updated_at = CURRENT_TIMESTAMP
    WHERE ${conditions.join(" AND ")}
    RETURNING *
    `,
    params,
  );

  return result.rows[0] || null;
}

async function disableRule({ ruleId, organisationId }) {
  const params = [ruleId];
  const conditions = ["id = $1"];

  conditions.push(appendOrganisationScope(params, organisationId));

  const result = await db.query(
    `
    UPDATE activity_app_rules
    SET active = false,
        updated_at = CURRENT_TIMESTAMP
    WHERE ${conditions.join(" AND ")}
    RETURNING id
    `,
    params,
  );

  return result.rows[0] || null;
}

async function saveActivityFeedback({ organisationId, userId, data }) {
  const result = await db.query(
    `
    INSERT INTO activity_feedback
      (
        organisation_id,
        utilisateur_id,
        activity_log_id,
        projet_id,
        app_name,
        window_title,
        confirmed_category,
        confirmed_tag,
        feedback_type
      )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
    `,
    [
      organisationId,
      userId,
      data.activityLogId || null,
      data.projet_id || null,
      data.app_name,
      data.window_title,
      data.confirmed_category || null,
      data.confirmed_tag || null,
      data.feedback_type,
    ],
  );

  const keyword = data.feedback_type === "confirmed" && data.projet_id ? buildFeedbackKeyword(data.window_title) : null;

  if (keyword) {
    await db
      .query(
        `
        INSERT INTO activity_patterns (organisation_id, projet_id, keyword, weight)
        VALUES ($1, $2, $3, 1)
        ON CONFLICT DO NOTHING
        `,
        [organisationId, data.projet_id, keyword],
      )
      .catch(() => null);
  }

  return result.rows[0];
}

module.exports = {
  appendOrganisationScope,
  buildFeedbackKeyword,
  classifyActivity,
  classifyActivities,
  detectMultiAppContext,
  getOrganisationId,

  missingActivityTables,
  getInsights,
  analyzeActivityLog,
  classifyCurrentContext,
  listRules,
  createRule,
  updateRule,
  disableRule,
  saveActivityFeedback,
};
