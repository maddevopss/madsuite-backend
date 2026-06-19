const db = require("../../db");
const { organisationScope, organisationValue } = require("../utils/organisationScope");

function scopedOrganisationCondition(params, organisationId) {
  return organisationScope("clients", params, organisationId).replace(/^AND\s+/, "");
}

async function listClients({ organisationId }) {
  const params = [];
  const conditions = ["deleted_at IS NULL"];

  conditions.push(scopedOrganisationCondition(params, organisationId));

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.query(`SELECT * FROM clients ${where} ORDER BY created_at DESC`, params);

  return result.rows;
}

async function getClientById({ clientId, organisationId }) {
  const params = [clientId];
  const conditions = ["id = $1", "deleted_at IS NULL"];

  conditions.push(scopedOrganisationCondition(params, organisationId));

  const result = await db.query(`SELECT * FROM clients WHERE ${conditions.join(" AND ")}`, params);

  return result.rows[0] || null;
}

async function createClient({ data, organisationId }) {
  const result = await db.query(
    `
    INSERT INTO clients (nom, hourly_rate_defaut, email, phone, organisation_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [data.nom, data.hourly_rate_defaut, data.email ?? null, data.phone ?? null, organisationValue(organisationId)],
  );

  return result.rows[0];
}

function addUpdateField({ data, field, column = field, setClauses, params }) {
  if (!Object.prototype.hasOwnProperty.call(data, field)) return;

  params.push(data[field]);
  setClauses.push(`${column} = $${params.length}`);
}

async function updateClient({ clientId, data, organisationId }) {
  const params = [];
  const setClauses = [];

  addUpdateField({ data, field: "nom", setClauses, params });
  addUpdateField({ data, field: "hourly_rate_defaut", setClauses, params });
  addUpdateField({ data, field: "email", setClauses, params });
  addUpdateField({ data, field: "phone", setClauses, params });

  if (setClauses.length === 0) {
    const err = new Error("Aucune mise a jour fournie.");
    err.statusCode = 400;
    throw err;
  }

  params.push(clientId);
  const conditions = [`id = $${params.length}`, "deleted_at IS NULL"];

  conditions.push(scopedOrganisationCondition(params, organisationId));

  const result = await db.query(
    `
    UPDATE clients
    SET ${setClauses.join(", ")}
    WHERE ${conditions.join(" AND ")}
    RETURNING *
    `,
    params,
  );

  return result.rows[0] || null;
}

async function deleteClient({ clientId, organisationId }) {
  try {
    const existing = await db.query(
      `
      SELECT id
      FROM clients
      WHERE id = $1
        AND organisation_id = $2
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      [clientId, organisationValue(organisationId)],
    );

    if (existing.rowCount === 0) {
      return null;
    }

    await db.query(
      `
      SELECT id
      FROM projets
      WHERE client_id = $1
        AND organisation_id = $2
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      [clientId, organisationValue(organisationId)],
    );

    const activeTimer = await db.query(
      `
      SELECT 1
      FROM time_entries te
      JOIN projets p ON p.id = te.projet_id
      WHERE p.client_id = $1
        AND te.organisation_id = $2
        AND te.end_time IS NULL
      LIMIT 1
      `,
      [clientId, organisationValue(organisationId)],
    );

    if (activeTimer.rowCount > 0) {
      const err = new Error("Impossible de supprimer ce client pendant qu'un timer roule sur un de ses projets.");
      err.statusCode = 409;
      throw err;
    }

    const result = await db.query(
      `
      UPDATE clients
      SET deleted_at = NOW()
      WHERE id = $1
        AND organisation_id = $2
        AND deleted_at IS NULL
      RETURNING id
      `,
      [clientId, organisationValue(organisationId)],
    );

    return result.rows[0] || null;
  } catch (err) {
    throw err;
  }
}

module.exports = {
  createClient,
  deleteClient,
  getClientById,
  listClients,
  updateClient,
};
