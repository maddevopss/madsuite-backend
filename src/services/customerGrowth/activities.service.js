const db = require("../../../db");
const { organisationScope, organisationValue } = require("../../utils/organisationScope");

const ACTIVITY_TYPES = new Set(["call", "email", "meeting", "note", "task"]);
const TASK_STATUSES = new Set(["pending", "completed", "cancelled"]);

function scopedOrganisationCondition(params, organisationId) {
  return organisationScope("sales_activities", params, organisationId).replace(/^AND\s+/, "");
}

function assertSingleParent(data) {
  const hasLead = data.lead_id !== null && data.lead_id !== undefined;
  const hasOpportunity = data.opportunity_id !== null && data.opportunity_id !== undefined;
  if (hasLead === hasOpportunity) {
    const error = new Error("Une activité doit être liée à un prospect ou à une opportunité, mais pas aux deux.");
    error.statusCode = 400;
    error.code = "ACTIVITY_SINGLE_PARENT_REQUIRED";
    throw error;
  }
}

function normalizeTaskFields(current, data) {
  const next = { ...data };
  const activityType = data.activity_type ?? current?.activity_type;
  const taskStatus = Object.prototype.hasOwnProperty.call(data, "task_status")
    ? data.task_status
    : current?.task_status;

  if (!ACTIVITY_TYPES.has(activityType)) {
    const error = new Error("Type d'activité invalide.");
    error.statusCode = 400;
    error.code = "ACTIVITY_TYPE_INVALID";
    throw error;
  }

  if (activityType === "task") {
    const normalizedStatus = taskStatus ?? "pending";
    if (!TASK_STATUSES.has(normalizedStatus)) {
      const error = new Error("Statut de tâche invalide.");
      error.statusCode = 400;
      error.code = "ACTIVITY_TASK_STATUS_INVALID";
      throw error;
    }
    next.task_status = normalizedStatus;
    if (normalizedStatus === "completed") {
      next.completed_at = data.completed_at ?? current?.completed_at ?? new Date();
    } else if (normalizedStatus === "pending") {
      next.completed_at = null;
    }
  } else {
    next.task_status = null;
    next.completed_at = null;
    next.due_at = null;
  }

  return next;
}

async function listActivities({
  organisationId,
  leadId = null,
  opportunityId = null,
  activityType = null,
  taskStatus = null,
  limit = 50,
  offset = 0,
}) {
  const params = [];
  const conditions = ["deleted_at IS NULL", scopedOrganisationCondition(params, organisationId)];

  if (leadId) {
    params.push(leadId);
    conditions.push(`lead_id = $${params.length}`);
  }
  if (opportunityId) {
    params.push(opportunityId);
    conditions.push(`opportunity_id = $${params.length}`);
  }
  if (activityType) {
    params.push(activityType);
    conditions.push(`activity_type = $${params.length}`);
  }
  if (taskStatus) {
    params.push(taskStatus);
    conditions.push(`task_status = $${params.length}`);
  }

  params.push(Math.min(Math.max(Number(limit) || 50, 1), 100));
  const limitIndex = params.length;
  params.push(Math.max(Number(offset) || 0, 0));
  const offsetIndex = params.length;

  const result = await db.query(
    `SELECT * FROM sales_activities
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params,
  );

  return result.rows;
}

async function getActivityById({ activityId, organisationId }) {
  const params = [activityId];
  const condition = scopedOrganisationCondition(params, organisationId);
  const result = await db.query(
    `SELECT * FROM sales_activities
      WHERE id = $1
        AND deleted_at IS NULL
        AND ${condition}`,
    params,
  );
  return result.rows[0] || null;
}

async function createActivity({ data, organisationId, actorUserId }) {
  assertSingleParent(data);
  const normalized = normalizeTaskFields(null, data);

  const result = await db.query(
    `INSERT INTO sales_activities (
       organisation_id, lead_id, opportunity_id, created_by,
       activity_type, task_status, subject, details, due_at, completed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      organisationValue(organisationId),
      normalized.lead_id ?? null,
      normalized.opportunity_id ?? null,
      actorUserId ?? null,
      normalized.activity_type,
      normalized.task_status ?? null,
      normalized.subject,
      normalized.details ?? null,
      normalized.due_at ?? null,
      normalized.completed_at ?? null,
    ],
  );

  return result.rows[0];
}

async function updateActivity({ activityId, data, organisationId }) {
  const current = await getActivityById({ activityId, organisationId });
  if (!current) return null;

  const candidate = { ...current, ...data };
  assertSingleParent(candidate);
  const normalized = normalizeTaskFields(current, data);
  const allowedFields = [
    "lead_id",
    "opportunity_id",
    "activity_type",
    "task_status",
    "subject",
    "details",
    "due_at",
    "completed_at",
  ];

  const params = [];
  const setClauses = [];
  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) continue;
    params.push(normalized[field]);
    setClauses.push(`${field} = $${params.length}`);
  }

  if (setClauses.length === 0) {
    const error = new Error("Aucune mise à jour d'activité fournie.");
    error.statusCode = 400;
    error.code = "ACTIVITY_UPDATE_EMPTY";
    throw error;
  }

  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(activityId);
  const idIndex = params.length;
  const condition = scopedOrganisationCondition(params, organisationId);

  const result = await db.query(
    `UPDATE sales_activities
        SET ${setClauses.join(", ")}
      WHERE id = $${idIndex}
        AND deleted_at IS NULL
        AND ${condition}
      RETURNING *`,
    params,
  );

  return result.rows[0] || null;
}

async function deleteActivity({ activityId, organisationId }) {
  const params = [activityId];
  const condition = scopedOrganisationCondition(params, organisationId);
  const result = await db.query(
    `UPDATE sales_activities
        SET deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND deleted_at IS NULL
        AND ${condition}
      RETURNING id`,
    params,
  );
  return result.rows[0] || null;
}

module.exports = {
  ACTIVITY_TYPES,
  TASK_STATUSES,
  assertSingleParent,
  createActivity,
  deleteActivity,
  getActivityById,
  listActivities,
  normalizeTaskFields,
  updateActivity,
};
