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
  const phone = data.telephone || data.phone || null;
  const result = await db.query(
    `
    INSERT INTO clients (nom, hourly_rate_defaut, email, phone, contact_name, adresse, notes, organisation_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
    `,
    [
      data.nom, 
      data.hourly_rate_defaut ?? 0, 
      data.email ?? null, 
      phone, 
      data.contact_name ?? null,
      data.adresse ?? null,
      data.notes ?? null,
      organisationValue(organisationId)
    ],
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
  
  if (data.telephone !== undefined || data.phone !== undefined) {
    const phoneVal = data.telephone !== undefined ? data.telephone : data.phone;
    params.push(phoneVal);
    setClauses.push(`phone = $${params.length}`);
  }

  addUpdateField({ data, field: "contact_name", setClauses, params });
  addUpdateField({ data, field: "adresse", setClauses, params });
  addUpdateField({ data, field: "notes", setClauses, params });

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
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const params = [clientId];
    const condition = scopedOrganisationCondition(params, organisationId);

    // 1. Verifier si le client existe (avec verrou)
    const existing = await client.query(
      `
      SELECT id
      FROM clients
      WHERE id = $1
        AND ${condition}
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      params,
    );

    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    // 2. Verrouiller les projets
    await client.query(
      `
      SELECT id
      FROM projets
      WHERE client_id = $1
        AND ${condition.replace('clients.organisation_id', 'organisation_id').replace('organisation_id', 'organisation_id')}
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      params,
    );

    // 3. Verifier s'il y a un timer actif
    const activeTimer = await client.query(
      `
      SELECT 1
      FROM time_entries te
      JOIN projets p ON p.id = te.projet_id
      WHERE p.client_id = $1
        AND ${condition.replace(/clients\.organisation_id|organisation_id/g, 'te.organisation_id')}
        AND te.end_time IS NULL
      LIMIT 1
      `,
      params,
    );

    if (activeTimer.rowCount > 0) {
      await client.query('ROLLBACK');
      const err = new Error("Impossible de supprimer ce client pendant qu'un timer roule sur un de ses projets.");
      err.statusCode = 409;
      throw err;
    }

    // 4. Supprimer en cascade les projets
    await client.query(
      `
      UPDATE projets
      SET deleted_at = NOW()
      WHERE client_id = $1
        AND ${condition.replace(/clients\.organisation_id|organisation_id/g, 'organisation_id')}
        AND deleted_at IS NULL
      `,
      params,
    );

    // 5. Supprimer le client
    const result = await client.query(
      `
      UPDATE clients
      SET deleted_at = NOW()
      WHERE id = $1
        AND ${condition}
        AND deleted_at IS NULL
      RETURNING id
      `,
      params,
    );

    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createClient,
  deleteClient,
  getClientById,
  listClients,
  updateClient,
};
