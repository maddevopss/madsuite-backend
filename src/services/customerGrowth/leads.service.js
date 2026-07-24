const db = require("../../../db");
const { organisationScope, organisationValue } = require("../../utils/organisationScope");

const ALLOWED_TRANSITIONS = {
  new: new Set(["contacted", "unqualified", "archived"]),
  contacted: new Set(["qualified", "unqualified", "archived"]),
  qualified: new Set(["archived"]),
  unqualified: new Set(["contacted", "archived"]),
  converted: new Set(),
  archived: new Set(),
};

function scopedOrganisationCondition(params, organisationId) {
  return organisationScope("sales_leads", params, organisationId).replace(/^AND\s+/, "");
}

function assertTransitionAllowed(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return;
  if (!ALLOWED_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    const error = new Error(`Transition de prospect interdite: ${currentStatus} -> ${nextStatus}`);
    error.statusCode = 409;
    error.code = "LEAD_TRANSITION_NOT_ALLOWED";
    throw error;
  }
}

async function listLeads({ organisationId, status = null, ownerUserId = null, limit = 50, offset = 0 }) {
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
    `SELECT * FROM sales_leads
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params,
  );

  return result.rows;
}

async function getLeadById({ leadId, organisationId }) {
  const params = [leadId];
  const condition = scopedOrganisationCondition(params, organisationId);
  const result = await db.query(
    `SELECT * FROM sales_leads
      WHERE id = $1
        AND deleted_at IS NULL
        AND ${condition}`,
    params,
  );
  return result.rows[0] || null;
}

async function createLead({ data, organisationId, actorUserId }) {
  const result = await db.query(
    `INSERT INTO sales_leads (
       organisation_id, owner_user_id, created_by, status,
       display_name, company_name, email, phone, source, notes
     ) VALUES ($1, $2, $3, 'new', $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      organisationValue(organisationId),
      data.owner_user_id ?? actorUserId ?? null,
      actorUserId ?? null,
      data.display_name,
      data.company_name ?? null,
      data.email ?? null,
      data.phone ?? null,
      data.source ?? null,
      data.notes ?? null,
    ],
  );
  return result.rows[0];
}

async function updateLead({ leadId, data, organisationId }) {
  const current = await getLeadById({ leadId, organisationId });
  if (!current) return null;

  if (Object.prototype.hasOwnProperty.call(data, "status")) {
    assertTransitionAllowed(current.status, data.status);
  }

  const allowedFields = [
    "owner_user_id",
    "status",
    "display_name",
    "company_name",
    "email",
    "phone",
    "source",
    "notes",
    "unqualified_reason",
    "archived_reason",
  ];

  const params = [];
  const setClauses = [];
  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    params.push(data[field]);
    setClauses.push(`${field} = $${params.length}`);
  }

  if (setClauses.length === 0) {
    const error = new Error("Aucune mise à jour de prospect fournie.");
    error.statusCode = 400;
    throw error;
  }

  if (data.status === "unqualified" && !data.unqualified_reason && !current.unqualified_reason) {
    const error = new Error("Un motif est requis pour disqualifier un prospect.");
    error.statusCode = 400;
    error.code = "UNQUALIFIED_REASON_REQUIRED";
    throw error;
  }
  if (data.status === "archived" && !data.archived_reason && !current.archived_reason) {
    const error = new Error("Un motif est requis pour archiver un prospect.");
    error.statusCode = 400;
    error.code = "ARCHIVED_REASON_REQUIRED";
    throw error;
  }

  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(leadId);
  const idIndex = params.length;
  const condition = scopedOrganisationCondition(params, organisationId);

  const result = await db.query(
    `UPDATE sales_leads
        SET ${setClauses.join(", ")}
      WHERE id = $${idIndex}
        AND deleted_at IS NULL
        AND ${condition}
      RETURNING *`,
    params,
  );
  return result.rows[0] || null;
}

async function deleteLead({ leadId, organisationId }) {
  const params = [leadId];
  const condition = scopedOrganisationCondition(params, organisationId);
  const result = await db.query(
    `UPDATE sales_leads
        SET deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND deleted_at IS NULL
        AND status <> 'converted'
        AND ${condition}
      RETURNING id`,
    params,
  );
  return result.rows[0] || null;
}

module.exports = {
  ALLOWED_TRANSITIONS,
  assertTransitionAllowed,
  createLead,
  deleteLead,
  getLeadById,
  listLeads,
  updateLead,
};
