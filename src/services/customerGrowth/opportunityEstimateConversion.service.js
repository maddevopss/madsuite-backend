const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");

function serviceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key || key.length > 128) {
    throw serviceError(
      "Une clé d'idempotence valide est requise pour créer la soumission.",
      400,
      "OPPORTUNITY_ESTIMATE_IDEMPOTENCY_KEY_INVALID",
    );
  }
  return key;
}

async function loadEstimate(client, estimateId, organisationId) {
  const estimateResult = await client.query(
    `SELECT * FROM estimates
      WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL`,
    [estimateId, organisationValue(organisationId)],
  );
  const estimate = estimateResult.rows[0];
  if (!estimate) {
    throw serviceError(
      "La soumission liée à l'opportunité est introuvable.",
      409,
      "OPPORTUNITY_ESTIMATE_MISSING",
    );
  }
  const itemsResult = await client.query(
    `SELECT * FROM estimate_items
      WHERE estimate_id = $1 AND organisation_id = $2
      ORDER BY id`,
    [estimateId, organisationValue(organisationId)],
  );
  return { ...estimate, items: itemsResult.rows };
}

async function convertOpportunityToEstimate({
  opportunityId,
  organisationId,
  idempotencyKey,
  issueDate = null,
  validUntil = null,
  taxRate = 0,
  notes = null,
}) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const organisation = organisationValue(organisationId);
  const rate = Number(taxRate || 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw serviceError("Le taux de taxe doit être compris entre 0 et 100.", 400, "OPPORTUNITY_ESTIMATE_TAX_RATE_INVALID");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const keyResult = await client.query(
      `SELECT * FROM sales_opportunities
        WHERE organisation_id = $1
          AND conversion_idempotency_key = $2
          AND deleted_at IS NULL
        FOR UPDATE`,
      [organisation, key],
    );
    const keyedOpportunity = keyResult.rows[0];
    if (keyedOpportunity) {
      if (Number(keyedOpportunity.id) !== Number(opportunityId)) {
        throw serviceError(
          "Cette clé d'idempotence a déjà été utilisée pour une autre opportunité.",
          409,
          "OPPORTUNITY_ESTIMATE_KEY_REUSED",
        );
      }
      if (keyedOpportunity.produced_estimate_id) {
        const estimate = await loadEstimate(client, keyedOpportunity.produced_estimate_id, organisation);
        await client.query("COMMIT");
        return { opportunity: keyedOpportunity, estimate, idempotent: true };
      }
    }

    const opportunityResult = await client.query(
      `SELECT * FROM sales_opportunities
        WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [opportunityId, organisation],
    );
    const opportunity = opportunityResult.rows[0];
    if (!opportunity) {
      await client.query("ROLLBACK");
      return null;
    }

    if (opportunity.produced_estimate_id) {
      if (opportunity.conversion_idempotency_key !== key) {
        throw serviceError("Cette opportunité possède déjà une soumission.", 409, "OPPORTUNITY_ESTIMATE_ALREADY_CREATED");
      }
      const estimate = await loadEstimate(client, opportunity.produced_estimate_id, organisation);
      await client.query("COMMIT");
      return { opportunity, estimate, idempotent: true };
    }
    if (opportunity.status !== "qualified") {
      throw serviceError(
        "Seule une opportunité qualifiée peut produire une soumission.",
        409,
        "OPPORTUNITY_NOT_QUALIFIED",
      );
    }
    if (!opportunity.client_id) {
      throw serviceError(
        "Un client doit être lié à l'opportunité avant de créer une soumission.",
        409,
        "OPPORTUNITY_CLIENT_REQUIRED",
      );
    }

    const subtotal = Number(opportunity.estimated_value);
    if (!Number.isFinite(subtotal) || subtotal <= 0) {
      throw serviceError(
        "Une valeur estimée supérieure à zéro est requise.",
        409,
        "OPPORTUNITY_ESTIMATED_VALUE_REQUIRED",
      );
    }

    await client.query("LOCK TABLE estimates IN SHARE ROW EXCLUSIVE MODE");
    const countResult = await client.query(
      "SELECT COUNT(*) FROM estimates WHERE organisation_id = $1",
      [organisation],
    );
    const sequence = Number(countResult.rows[0].count) + 1;
    const estimateNumber = `EST-${new Date().getFullYear()}-${String(sequence).padStart(4, "0")}`;
    const taxTotal = subtotal * rate / 100;
    const total = subtotal + taxTotal;

    const estimateResult = await client.query(
      `INSERT INTO estimates (
         organisation_id, client_id, estimate_number, status,
         issue_date, valid_until, subtotal, tax_total, total, notes
       ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        organisation,
        opportunity.client_id,
        estimateNumber,
        issueDate,
        validUntil,
        subtotal,
        taxTotal,
        total,
        notes || opportunity.description || null,
      ],
    );
    const estimate = estimateResult.rows[0];

    const itemResult = await client.query(
      `INSERT INTO estimate_items (
         organisation_id, estimate_id, description, quantity, unit_rate, amount
       ) VALUES ($1, $2, $3, 1, $4, $4)
       RETURNING *`,
      [organisation, estimate.id, opportunity.title, subtotal],
    );

    const updatedOpportunityResult = await client.query(
      `UPDATE sales_opportunities
          SET status = 'proposal',
              produced_estimate_id = $1,
              conversion_idempotency_key = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND organisation_id = $4
          AND deleted_at IS NULL AND status = 'qualified'
        RETURNING *`,
      [estimate.id, key, opportunityId, organisation],
    );
    if (!updatedOpportunityResult.rows[0]) {
      throw serviceError(
        "L'état de l'opportunité a changé pendant la conversion.",
        409,
        "OPPORTUNITY_ESTIMATE_STATE_CHANGED",
      );
    }

    await client.query("COMMIT");
    return {
      opportunity: updatedOpportunityResult.rows[0],
      estimate: { ...estimate, items: [itemResult.rows[0]] },
      idempotent: false,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // Préserver l'erreur originale.
    }
    if (error?.code === "23505") {
      throw serviceError("Cette clé d'idempotence a déjà été utilisée.", 409, "OPPORTUNITY_ESTIMATE_KEY_REUSED");
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  convertOpportunityToEstimate,
  normalizeIdempotencyKey,
};
