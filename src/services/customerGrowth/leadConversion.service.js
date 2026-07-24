const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");

function createServiceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key || key.length > 128) {
    throw createServiceError(
      "Une clé d'idempotence valide est requise pour convertir le prospect.",
      400,
      "LEAD_CONVERSION_IDEMPOTENCY_KEY_INVALID",
    );
  }
  return key;
}

async function loadConvertedResult(client, lead, organisationId, idempotent) {
  const clientResult = await client.query(
    `SELECT * FROM clients
      WHERE id = $1
        AND organisation_id = $2
        AND deleted_at IS NULL`,
    [lead.converted_client_id, organisationValue(organisationId)],
  );

  if (!clientResult.rows[0]) {
    throw createServiceError(
      "Le client lié à la conversion est introuvable.",
      409,
      "LEAD_CONVERSION_CLIENT_MISSING",
    );
  }

  return {
    lead,
    client: clientResult.rows[0],
    idempotent,
  };
}

async function convertLeadToClient({ leadId, organisationId, idempotencyKey }) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const organisation = organisationValue(organisationId);
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const existingKeyResult = await client.query(
      `SELECT * FROM sales_leads
        WHERE organisation_id = $1
          AND conversion_idempotency_key = $2
          AND deleted_at IS NULL
        FOR UPDATE`,
      [organisation, key],
    );

    const existingKeyLead = existingKeyResult.rows[0];
    if (existingKeyLead) {
      if (Number(existingKeyLead.id) !== Number(leadId)) {
        throw createServiceError(
          "Cette clé d'idempotence a déjà été utilisée pour un autre prospect.",
          409,
          "LEAD_CONVERSION_KEY_REUSED",
        );
      }
      if (existingKeyLead.status === "converted") {
        const result = await loadConvertedResult(client, existingKeyLead, organisation, true);
        await client.query("COMMIT");
        return result;
      }
    }

    const leadResult = await client.query(
      `SELECT * FROM sales_leads
        WHERE id = $1
          AND organisation_id = $2
          AND deleted_at IS NULL
        FOR UPDATE`,
      [leadId, organisation],
    );

    const lead = leadResult.rows[0];
    if (!lead) {
      await client.query("ROLLBACK");
      return null;
    }

    if (lead.status === "converted") {
      if (lead.conversion_idempotency_key === key) {
        const result = await loadConvertedResult(client, lead, organisation, true);
        await client.query("COMMIT");
        return result;
      }
      throw createServiceError(
        "Ce prospect a déjà été converti.",
        409,
        "LEAD_ALREADY_CONVERTED",
      );
    }

    if (lead.status !== "qualified") {
      throw createServiceError(
        "Seul un prospect qualifié peut être converti en client.",
        409,
        "LEAD_NOT_QUALIFIED",
      );
    }

    const clientName = String(lead.company_name || lead.display_name || "").trim();
    if (!clientName) {
      throw createServiceError(
        "Le prospect ne contient aucun nom utilisable pour créer le client.",
        409,
        "LEAD_CONVERSION_CLIENT_NAME_MISSING",
      );
    }

    const contactName = lead.company_name ? lead.display_name : null;
    const createdClientResult = await client.query(
      `INSERT INTO clients (
         nom, hourly_rate_defaut, email, phone, contact_name, notes, organisation_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        clientName,
        0,
        lead.email ?? null,
        lead.phone ?? null,
        contactName ?? null,
        lead.notes ?? null,
        organisation,
      ],
    );

    const createdClient = createdClientResult.rows[0];
    const convertedLeadResult = await client.query(
      `UPDATE sales_leads
          SET status = 'converted',
              converted_client_id = $1,
              converted_at = CURRENT_TIMESTAMP,
              conversion_idempotency_key = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
          AND organisation_id = $4
          AND deleted_at IS NULL
          AND status = 'qualified'
        RETURNING *`,
      [createdClient.id, key, leadId, organisation],
    );

    if (!convertedLeadResult.rows[0]) {
      throw createServiceError(
        "Le prospect n'a pas pu être marqué comme converti.",
        409,
        "LEAD_CONVERSION_STATE_CHANGED",
      );
    }

    await client.query("COMMIT");
    return {
      lead: convertedLeadResult.rows[0],
      client: createdClient,
      idempotent: false,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // Preserve the original failure.
    }

    if (error?.code === "23505") {
      throw createServiceError(
        "Cette clé d'idempotence a déjà été utilisée.",
        409,
        "LEAD_CONVERSION_KEY_REUSED",
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  convertLeadToClient,
  normalizeIdempotencyKey,
};
