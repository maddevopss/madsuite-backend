const db = require("../../db");
const { organisationScope, organisationValue } = require("../utils/organisationScope");

function scopedOrganisationCondition(alias, params, organisationId) {
  return organisationScope(alias, params, organisationId).replace(/^AND\s+/, "");
}

async function listProjects({ organisationId }) {
  const params = [];
  const conditions = ["p.deleted_at IS NULL", "c.deleted_at IS NULL"];

  conditions.push(scopedOrganisationCondition("p", params, organisationId));
  conditions.push(scopedOrganisationCondition("c", params, organisationId));

  const result = await db.query(
    `
    SELECT
      p.*,
      c.nom AS client_nom
    FROM projets p
    JOIN clients c ON c.id = p.client_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.nom ASC
    `,
    params,
  );

  return result.rows;
}

async function listProjectsByClient({ clientId, organisationId }) {
  const params = [clientId];
  const conditions = ["p.client_id = $1", "p.deleted_at IS NULL", "c.deleted_at IS NULL"];

  conditions.push(scopedOrganisationCondition("p", params, organisationId));
  conditions.push(scopedOrganisationCondition("c", params, organisationId));

  const result = await db.query(
    `
    SELECT p.*
    FROM projets p
    JOIN clients c ON c.id = p.client_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.id DESC
    `,
    params,
  );

  return result.rows;
}

async function ensureClientExists({ clientId, organisationId }) {
  const params = [clientId];
  const conditions = ["id = $1", "deleted_at IS NULL"];

  conditions.push(scopedOrganisationCondition("clients", params, organisationId));

  const result = await db.query(`SELECT id FROM clients WHERE ${conditions.join(" AND ")}`, params);

  return result.rows.length > 0;
}

async function getProjectById({ projectId, organisationId }) {
  const params = [projectId];
  const conditions = ["p.id = $1", "p.deleted_at IS NULL", "c.deleted_at IS NULL"];

  conditions.push(scopedOrganisationCondition("p", params, organisationId));
  conditions.push(scopedOrganisationCondition("c", params, organisationId));

  const result = await db.query(
    `
    SELECT
      p.*,
      c.nom AS client_nom
    FROM projets p
    JOIN clients c ON c.id = p.client_id
    WHERE ${conditions.join(" AND ")}
    `,
    params,
  );

  return result.rows[0] || null;
}

function buildProjectInsert({ data, organisationId }) {
  const {
    client_id,
    nom,
    description = null,
    date_fin = null,
    budget = null,
    estimated_hours = null,
    taux_horaire = null,
    budget_hours = 0,
    budget_amount = 0,
    billing_increment = 1,
    billing_rounding_type = "exact",
    status = "actif",
    couleur = null,
  } = data;

  const params = [client_id, nom, description, date_fin, budget, estimated_hours, taux_horaire, status, couleur, budget_hours, budget_amount, billing_increment, billing_rounding_type];
  const clientConditions = ["c.id = $1", "c.deleted_at IS NULL"];

  params.push(organisationValue(organisationId));

  return {
    clientConditions,
    params,
    sql: `
      INSERT INTO projets
        (client_id, nom, description, date_fin, budget, estimated_hours, taux_horaire, status, couleur, budget_hours, budget_amount, billing_increment, billing_rounding_type, organisation_id)
      SELECT c.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $${params.length}
      FROM clients c
      WHERE %CLIENT_CONDITIONS%
      RETURNING *
    `,
  };
}

async function createProject({ data, organisationId }) {
  const { clientConditions, params, sql } = buildProjectInsert({ data, organisationId });

  clientConditions.push(scopedOrganisationCondition("c", params, organisationId));

  const result = await db.query(sql.replace("%CLIENT_CONDITIONS%", clientConditions.join(" AND ")), params);

  return result.rows[0] || null;
}

function addOptionalSet(setClauses, params, column, value) {
  params.push(value);
  setClauses.push(`${column} = COALESCE($${params.length}, ${column})`);
}

async function assertProjectHasNoActiveTimer({ projectId, organisationId }) {
  const project = await db.query(
    `
    SELECT id
    FROM projets
    WHERE id = $1
      AND organisation_id = $2
      AND deleted_at IS NULL
    FOR UPDATE
    `,
    [projectId, organisationValue(organisationId)],
  );

  if (project.rowCount === 0) return false;

  const activeTimer = await db.query(
    `
    SELECT 1
    FROM time_entries
    WHERE projet_id = $1
      AND organisation_id = $2
      AND end_time IS NULL
    LIMIT 1
    `,
    [projectId, organisationValue(organisationId)],
  );

  if (activeTimer.rowCount > 0) {
    const err = new Error("Impossible d'archiver ce projet pendant qu'un timer est actif. Arrêtez le timer d'abord.");
    err.statusCode = 409;
    throw err;
  }

  return true;
}

async function updateProject({ projectId, data, organisationId }) {
  if (data.client_id !== undefined && !(await ensureClientExists({ clientId: data.client_id, organisationId }))) {
    return { missingClient: true, project: null };
  }

  const params = [data.client_id, data.nom, data.description, data.date_fin, data.budget];
  const setClauses = [
    "client_id = COALESCE($1, client_id)",
    "nom = COALESCE($2, nom)",
    "description = COALESCE($3, description)",
    "date_fin = COALESCE($4, date_fin)",
    "budget = COALESCE($5, budget)",
  ];

  addOptionalSet(setClauses, params, "estimated_hours", data.estimated_hours);
  addOptionalSet(setClauses, params, "taux_horaire", data.taux_horaire);
  addOptionalSet(setClauses, params, "status", data.status);
  addOptionalSet(setClauses, params, "couleur", data.couleur);
  addOptionalSet(setClauses, params, "budget_hours", data.budget_hours);
  addOptionalSet(setClauses, params, "budget_amount", data.budget_amount);
  addOptionalSet(setClauses, params, "billing_increment", data.billing_increment);
  addOptionalSet(setClauses, params, "billing_rounding_type", data.billing_rounding_type);

  params.push(projectId);
  const conditions = [`id = $${params.length}`, "deleted_at IS NULL"];

  conditions.push(scopedOrganisationCondition("projets", params, organisationId));

  try {
    if (data.status === "archive") {
      const exists = await assertProjectHasNoActiveTimer({ projectId, organisationId });
      if (!exists) return { missingClient: false, project: null };
    }

    const result = await db.query(
      `
      UPDATE projets
      SET ${setClauses.join(", ")}
      WHERE ${conditions.join(" AND ")}
      RETURNING *
      `,
      params,
    );

    return { missingClient: false, project: result.rows[0] || null };
  } catch (err) {
    throw err;
  }
}

async function deleteProject({ projectId, organisationId }) {
  try {
    const exists = await assertProjectHasNoActiveTimer({ projectId, organisationId });

    if (!exists) {
      return null;
    }
    const result = await db.query(
      `
      UPDATE projets
      SET deleted_at = NOW(),
          status = 'archive'
      WHERE id = $1
        AND organisation_id = $2
        AND deleted_at IS NULL
      RETURNING id
      `,
      [projectId, organisationValue(organisationId)],
    );

    return result.rows[0] || null;
  } catch (err) {
    throw err;
  }
}

module.exports = {
  createProject,
  deleteProject,
  getProjectById,
  listProjects,
  listProjectsByClient,
  updateProject,
};
