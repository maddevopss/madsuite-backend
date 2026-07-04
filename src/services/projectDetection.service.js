const db = require("../../db");

const logger = require("../config/logger");
const { hasColumn } = require("../utils/dbSchema");
const { buildFeedbackKeyword } = require("./activityIntelligence.service");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

function tokenize(value) {
  return normalize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3);
}

function containsPhrase(text, phrase) {
  const normalizedText = normalize(text);
  const normalizedPhrase = normalize(phrase);

  return Boolean(normalizedPhrase && normalizedText.includes(normalizedPhrase));
}

function addOrganisationScope(conditions, params, alias, organisationId) {
  if (!organisationId) {
    const err = new Error("OrganisationId requis pour la detection projet.");
    err.statusCode = 403;
    throw err;
  }

  params.push(organisationId);
  conditions.push(`${alias}.organisation_id = $${params.length}`);
}

function scoreProject(text, project, patterns = []) {
  let score = 0;

  const projectName = normalize(project.nom);
  const textTokens = new Set(tokenize(text));
  const projectTokens = tokenize(project.nom);

  if (containsPhrase(text, projectName)) {
    score += 72;
  } else if (projectTokens.length) {
    const matchedTokens = projectTokens.filter((token) => textTokens.has(token));
    const tokenRatio = matchedTokens.length / projectTokens.length;

    if (tokenRatio >= 0.75) score += 62;
    else if (tokenRatio >= 0.5) score += 42;
    else if (matchedTokens.length > 0) score += 22;
  }

  for (const pattern of patterns) {
    const keyword = normalize(pattern.keyword);

    if (Number(pattern.projet_id) === Number(project.id) && keyword && containsPhrase(text, keyword)) {
      score += 24 * Number(pattern.weight || 1);
    }
  }

  return Math.min(Math.round(score), 100);
}

async function getPatterns(organisationId) {
  try {
    const hasOrganisationId = await hasColumn("activity_patterns", "organisation_id");
    const params = [];
    const conditions = [];

    if (hasOrganisationId) {
      addOrganisationScope(conditions, params, "activity_patterns", organisationId);
    }

    const result = await db.query(
      `
      SELECT projet_id, keyword, COALESCE(weight, 1) AS weight
      FROM activity_patterns
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      `,
      params,
    );

    return result.rows || [];
  } catch (err) {
    if (err.code === "42P01" || err.code === "42703") return [];

    logger.warn("projectDetection getPatterns fallback", { error: err.message });
    return [];
  }
}

async function getActiveProjects(organisationId) {
  const hasOrganisationId = await hasColumn("projets", "organisation_id");

  const params = [];
  if (hasOrganisationId && !organisationId) {
    const err = new Error("OrganisationId requis pour la detection projet.");
    err.statusCode = 403;
    throw err;
  }

  const organisationFilter = hasOrganisationId ? "organisation_id = $1" : "1=1";

  if (hasOrganisationId) {
    params.push(organisationId);
  }

  const queries = [
    `
    SELECT id, nom, client_id
    FROM projets
    WHERE COALESCE(status, 'actif') = 'actif'
      AND deleted_at IS NULL
      AND ${organisationFilter}
    ORDER BY nom ASC
    `,
    `
    SELECT id, nom, client_id
    FROM projets
    WHERE COALESCE(status, 'actif') = 'actif'
      AND deleted_at IS NULL
      AND ${organisationFilter}
    ORDER BY nom ASC
    `,
    `
    SELECT id, nom, client_id
    FROM projets
    WHERE deleted_at IS NULL AND ${organisationFilter}
    ORDER BY nom ASC
    `,
  ];

  for (const query of queries) {
    try {
      const result = await db.query(query, params);
      return result.rows || [];
    } catch (err) {
      if (err.code === "42P01") return [];

      if (err.code !== "42703") {
        logger.warn("projectDetection getActiveProjects fallback", { error: err.message });
      }
    }
  }

  try {
    const fallbackQuery = `
      SELECT id, nom
      FROM projets
      WHERE deleted_at IS NULL
        AND ${organisationFilter}
      ORDER BY nom ASC
    `;

    const result = await db.query(fallbackQuery, params);

    return result.rows || [];
  } catch (err) {
    logger.warn("projectDetection getActiveProjects empty fallback", { error: err.message });
    return [];
  }
}

async function ensureProjectInOrganisation({ projetId, organisationId }) {
  if (!projetId) return false;

  const result = await db.query(
    `SELECT id FROM projets WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [projetId, organisationId],
  );

  return result.rowCount > 0;
}

async function suggestProject({ appName = "", windowTitle = "", organisationId }) {
  const text = `${appName} ${windowTitle}`;
  const projects = await getActiveProjects(organisationId);
  const patterns = await getPatterns(organisationId);

  const suggestions = projects
    .map((project) => ({
      ...project,
      confidence: scoreProject(text, project, patterns),
      source: "project-detection",
    }))
    .filter((project) => project.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  return {
    suggestion: suggestions[0] || null,
    suggestions,
  };
}

async function createPattern({ projetId, keyword, weight, organisationId }) {
  const projectExists = await ensureProjectInOrganisation({ projetId, organisationId });

  if (!projectExists) {
    const err = new Error("Projet introuvable pour cette organisation.");
    err.statusCode = 404;
    throw err;
  }

  const result = await db.query(
    `
    INSERT INTO activity_patterns (organisation_id, projet_id, keyword, weight)
    VALUES ($1, $2, $3, $4)
    RETURNING *
    `,
    [organisationId, projetId, keyword, weight],
  );

  return result.rows[0];
}

async function updateActivityLogSuggestion({ activityLogId, projetId, feedbackType, userId, organisationId }) {
  if (!activityLogId) return;

  await db
    .query(
      `
      UPDATE activity_logs
      SET project_suggestion_id = $1,
          confidence_score = CASE
            WHEN $2 = 'rejected' THEN 0
            ELSE GREATEST(confidence_score, 90)
          END
      WHERE id = $3
        AND utilisateur_id = $4
        AND organisation_id = $5
      `,
      [feedbackType === "rejected" ? null : projetId || null, feedbackType, activityLogId, userId, organisationId],
    )
    .catch(() => null);
}

async function maybeCreateFeedbackPattern({ feedbackType, projetId, windowTitle, organisationId }) {
  const keyword = feedbackType !== "rejected" && projetId ? buildFeedbackKeyword(windowTitle) : null;

  if (!keyword) return null;

  const projectExists = await ensureProjectInOrganisation({ projetId, organisationId });
  if (!projectExists) return null;

  await db
    .query(
      `
      INSERT INTO activity_patterns (organisation_id, projet_id, keyword, weight)
      VALUES ($1, $2, $3, 1)
      `,
      [organisationId, projetId, keyword],
    )
    .catch(() => null);

  return keyword;
}

async function saveFeedback({ userId, organisationId, activityLogId, projetId, appName, windowTitle, feedbackType }) {
  if (projetId) {
    const projectExists = await ensureProjectInOrganisation({ projetId, organisationId });

    if (!projectExists) {
      const err = new Error("Projet introuvable pour cette organisation.");
      err.statusCode = 404;
      throw err;
    }
  }

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
        feedback_type
      )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
    `,
    [organisationId, userId, activityLogId || null, projetId || null, appName, windowTitle, feedbackType],
  );

  await updateActivityLogSuggestion({
    activityLogId,
    projetId,
    feedbackType,
    userId,
    organisationId,
  });

  await maybeCreateFeedbackPattern({
    feedbackType,
    projetId,
    windowTitle,
    organisationId,
  });

  return result.rows[0];
}

module.exports = {
  normalize,
  tokenize,
  containsPhrase,
  scoreProject,
  getPatterns,
  getActiveProjects,
  suggestProject,
  createPattern,
  saveFeedback,
};
