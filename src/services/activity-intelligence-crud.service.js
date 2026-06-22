const db = require("../../db");
const { appendOrganisationScope, buildFeedbackKeyword } = require("./activity-intelligence-utils");

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
  getCustomRules,
  listRules,
  createRule,
  getRuleById,
  updateRule,
  disableRule,
  saveActivityFeedback,
};
