const db = require("../../../db");
const { organisationScope, organisationValue } = require("../../utils/organisationScope");

const ALLOWED_TRANSITIONS = {
  open: new Set(["qualified", "lost", "abandoned"]),
  qualified: new Set(["proposal", "lost", "abandoned"]),
  proposal: new Set(["negotiation", "won", "lost", "abandoned"]),
  negotiation: new Set(["won", "lost", "abandoned"]),
  won: new Set(),
  lost: new Set(["open"]),
  abandoned: new Set(),
};

function scopedOrganisationCondition(params, organisationId) {
  return organisationScope("sales_opportunities", params, organisationId).replace(/^AND\s+/, "");
}

function assertTransitionAllowed(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return;
  if (!ALLOWED_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    const error = new Error(`Transition d'opportunité interdite: ${currentStatus} -> ${nextStatus}`);
    error.statusCode = 409;
    error.code = "OPPORTUNITY_TRANSITION_NOT_ALLOWED";
    throw error;
  }
}

function normalizeClosingFields(current, data) {
  const next = { ...data };
  if (!Object.prototype.hasOwnProperty.call(data, "status")) return next;

  if (data.status === "won") {
    if (!current.client_id && !data.client_id) {
      const error = new Error("Un client est requis pour gagner une opportunité.");
      error.statusCode = 400;
      error.code = "OPPORTUNITY_CLIENT_REQUIRED";
      throw error;
    }
    next.won_at = new Date();
    next.closed_at = next.won_at;
  } else if (data.status === "lost") {
    if (!data.lost_reason && !current.lost_reason) {
      const error = new Error("Un motif est requis pour perdre une opportunité.");
      error.statusCode = 400;
      error.code = "OPPORTUNITY_LOST_REASON_REQUIRED";
      throw error;
    }
    next.closed_at = new Date();
    next.won_at = null;
  } else if (data.status === "abandoned") {
    if (!data.abandoned_reason && !current.abandoned_reason) {
      const error = new Error("Un motif est requis pour abandonner une opportunité.");
      error.statusCode = 400;
      error.code = "OPPORTUNITY_ABANDONED_REASON_REQUIRED";
      throw error;
    }
    next.closed_at = new Date();
    next.won_at = null;
  } else if (current.status === "lost" && data.status === "open") {
    next.closed_at = null;
    next.won_at = null;
  }

  return next;
}

async function listOpportunities({ organisationId, status = null, ownerUserId = null, limit = 50, offset = 0 }) {
  const params = [];
  const conditions = ["deleted_at IS NULL", scopedOrganisationCondition(params, organisationId)];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (ownerUserId) {
    params.push(ownerUserId);
    conditions.push(`owner_user_id = $${params.length}`);
  }

  params.push(Math.min(Math.max(Number(limit) || 50, 1), 100));
  const limitIndex = params.length;
  params.push(Math.max(Number(offset) || 0, 0));
  const offsetIndex = params.length;

  const result = await db.query(
    `SELECT * FROM sales_opportunities
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params,
  );

  return result.rows;
}

async function getOpportunityById({ opportunityId, organisationId }) {
  const params = [opportunityId];
  const condition = scopedOrganisationCondition(params, organisationId);
  const result = await db.query(
    `SELECT * FROM sales_opportunities
      WHERE id = $1
        AND deleted_at IS NULL
        AND ${condition}`,
    params,
  );
  return result.rows[0] || null;
}

async function createOpportunity({ data, organisationId, actorUserId }) {
  if (!data.lead_id && !data.client_id) {
    const error = new Error("Un prospect ou un client est requis.");
    error.statusCode = 400;
    error.code = "OPPORTUNITY_ORIGIN_REQUIRED";
    throw error;
  }

  const result = await db.query(
    `INSERT INTO sales_opportunities (
       organisation_id, lead_id, client_id, owner_user_id, created_by,
       status, title, description, estimated_value, probability, expected_close_date
     ) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      organisationValue(organisationId),
      data.lead_id ?? null,
      data.client_id ?? null,
      data.owner_user_id ?? actorUserId ?? null,
      actorUserId ?? null,
      data.title,
      data.description ?? null,
      data.estimated_value ?? null,
      data.probability ?? null,
      data.expected_close_date ?? null,
    ],
  );
  return result.rows[0];
}

async function updateOpportunity({ opportunityId, data, organisationId }) {
  const current = await getOpportunityById({ opportunityId, organisationId });
  if (!current) return null;

  if (Object.prototype.hasOwnProperty.call(data, "status")) {
    assertTransitionAllowed(current.status, data.status);
  }

  const normalized = normalizeClosingFields(current, data);
  const allowedFields = [
    "lead_id",
    "client_id",
    "owner_user_id",
    "status",
    "title",
    "description",
    "estimated_value",
    "probability",
    "expected_close_date",
    "lost_reason",
    "abandoned_reason",
    "won_at",
    "closed_at",
  ];

  const params = [];
  const setClauses = [];
  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) continue;
    params.push(normalized[field]);
    setClauses.push(`${field} = $${params.length}`);
  }

  if (setClauses.length === 0) {
    const error = new Error("Aucune mise à jour d'opportunité fournie.");
    error.statusCode = 400;
    throw error;
  }

  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(opportunityId);
  const idIndex = params.length;
  const condition = scopedOrganisationCondition(params, organisationId);

  const result = await db.query(
    `UPDATE sales_opportunities
        SET ${setClauses.join(", ")}
      WHERE id = $${idIndex}
        AND deleted_at IS NULL
        AND ${condition}
      RETURNING *`,
    params,
  );
  return result.rows[0] || null;
}

async function deleteOpportunity({ opportunityId, organisationId }) {
  const params = [opportunityId];
  const condition = scopedOrganisationCondition(params, organisationId);
  const result = await db.query(
    `UPDATE sales_opportunities
        SET deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND deleted_at IS NULL
        AND status NOT IN ('won', 'lost')
        AND ${condition}
      RETURNING id`,
    params,
  );
  return result.rows[0] || null;
}

module.exports = {
  ALLOWED_TRANSITIONS,
  assertTransitionAllowed,
  createOpportunity,
  deleteOpportunity,
  getOpportunityById,
  listOpportunities,
  normalizeClosingFields,
  updateOpportunity,
};
