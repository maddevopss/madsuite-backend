const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment } = require("./trust-persistence.service");
const { assessTrainingCompliance } = require("./sst-complete-block.service");

const TRAINING_ASSIGN_POLICY = "sst.training.assign@1";
const TRAINING_TRANSITION_POLICY = "sst.training.transition@1";

const STATUS_BY_ACTION = { start: "in_progress", complete: "completed", waive: "waived", cancel: "cancelled", expire: "expired" };
const ALLOWED_TRANSITIONS = {
  assigned: ["start", "waive", "cancel", "expire"],
  in_progress: ["complete", "waive", "cancel", "expire"],
  completed: [],
  waived: [],
  cancelled: [],
  expired: [],
};

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("sst.training.assign", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  if (!input?.employeeId || !String(input?.trainingCode || "").trim() || !String(input?.title || "").trim()) {
    return { allowed: false, statusCode: 400, reason: "Employé, code et titre de la formation sont requis." };
  }
  return { allowed: true };
});

registerPolicy("sst.training.transition", "1", ({ input, idempotencyKey }) => {
  if (!input?.assignmentId || !input?.action || !validIdempotency(idempotencyKey)) {
    return { allowed: false, statusCode: 400, reason: "Affectation, action et clé d’idempotence sont requises." };
  }
  if (!Object.keys(STATUS_BY_ACTION).includes(input.action)) return { allowed: false, statusCode: 400, reason: "Action de formation invalide." };
  if (["waive", "cancel"].includes(input.action) && !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, reason: "Une raison est obligatoire pour cette transition." };
  if (input.action === "complete" && input.score != null) {
    const score = Number(input.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return { allowed: false, statusCode: 400, reason: "La note doit être comprise entre 0 et 100." };
  }
  return { allowed: true };
});

async function assignTraining({ organisationId, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "sst.training.assign",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [TRAINING_ASSIGN_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM sst_training_assignments WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) return { duplicate: true, assignment: duplicate.rows[0] };

      const employee = await client.query("SELECT id FROM hr_employees WHERE organisation_id=$1 AND id=$2", [orgId, input.employeeId]);
      if (!employee.rows[0]) throw Object.assign(new Error("Employé introuvable."), { statusCode: 404 });

      if (input.competencyId) {
        const competency = await client.query("SELECT id FROM hr_competencies WHERE organisation_id=$1 AND id=$2", [orgId, input.competencyId]);
        if (!competency.rows[0]) throw Object.assign(new Error("Compétence introuvable."), { statusCode: 404 });
      }

      const inserted = await client.query(
        `INSERT INTO sst_training_assignments (organisation_id,employee_id,competency_id,training_code,title,due_at,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [orgId, input.employeeId, input.competencyId || null, input.trainingCode, input.title, input.dueAt || null, idempotencyKey],
      );
      const assignment = inserted.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "sst.training.assigned",
        aggregateType: "sst_training_assignment",
        aggregateId: assignment.id,
        actorUserId,
        correlationId,
        payload: { employeeId: assignment.employee_id, trainingCode: assignment.training_code, dueAt: assignment.due_at },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "sst.training_assigned_to_valid_employee", passed: true, evidence: [{ employeeId: assignment.employee_id }] }],
      });
      return { duplicate: false, assignment, event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function transitionTrainingAssignment({ organisationId, assignmentId, action, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "sst.training.transition",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [TRAINING_TRANSITION_POLICY],
    input: { ...input, assignmentId, action },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM sst_training_assignment_transitions WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) {
        const assignment = await client.query("SELECT * FROM sst_training_assignments WHERE organisation_id=$1 AND id=$2", [orgId, duplicate.rows[0].assignment_id]);
        return { duplicate: true, assignment: assignment.rows[0], transition: duplicate.rows[0] };
      }

      const locked = await client.query("SELECT * FROM sst_training_assignments WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [orgId, assignmentId]);
      const assignment = locked.rows[0];
      if (!assignment) return null;

      if (!ALLOWED_TRANSITIONS[assignment.status]?.includes(action)) {
        throw Object.assign(new Error(`Transition de formation invalide : ${assignment.status} -> ${action}.`), { statusCode: 409 });
      }
      const newStatus = STATUS_BY_ACTION[action];
      const score = action === "complete" && input.score != null ? Number(input.score) : assignment.score;
      const evidence = input.evidence !== undefined ? input.evidence : assignment.evidence;
      const completedAt = newStatus === "completed" ? new Date().toISOString() : assignment.completed_at;

      const updated = await client.query(
        `UPDATE sst_training_assignments SET status=$1, score=$2, evidence=$3, completed_at=$4
         WHERE organisation_id=$5 AND id=$6 RETURNING *`,
        [newStatus, score, JSON.stringify(evidence || []), completedAt, orgId, assignmentId],
      );
      const next = updated.rows[0];

      const transition = await client.query(
        `INSERT INTO sst_training_assignment_transitions (organisation_id,assignment_id,action,previous_status,new_status,actor_user_id,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [orgId, assignmentId, action, assignment.status, newStatus, actorUserId || null, idempotencyKey],
      );

      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: `sst.training.${newStatus}`,
        aggregateType: "sst_training_assignment",
        aggregateId: assignmentId,
        actorUserId,
        correlationId,
        payload: { previousStatus: assignment.status, newStatus, action, reason: input.reason || null },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "sst.training_transition_recorded", passed: true, evidence: [{ transitionId: transition.rows[0].id, action }] }],
      });
      return { duplicate: false, assignment: next, transition: transition.rows[0], event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

// Interrogé par toute future fonctionnalité d'affectation (tâche, chantier)
// qui voudrait bloquer/avertir si un employé n'a pas les formations SST
// requises -- aucune entité d'affectation de tâche n'existe encore dans ce
// dépôt, donc ce PR expose le contrôle de conformité réutilisable sans
// inventer cette intégration.
async function getEmployeeTrainingCompliance({ organisationId, employeeId, db }) {
  const { rows } = await db.query(
    "SELECT * FROM sst_training_assignments WHERE organisation_id=$1 AND employee_id=$2",
    [organisationId, employeeId],
  );
  const compliance = assessTrainingCompliance(rows.map((row) => ({ status: row.status, dueAt: row.due_at })));
  return { compliance, assignments: rows };
}

module.exports = {
  TRAINING_ASSIGN_POLICY,
  TRAINING_TRANSITION_POLICY,
  ALLOWED_TRANSITIONS,
  STATUS_BY_ACTION,
  assignTraining,
  transitionTrainingAssignment,
  getEmployeeTrainingCompliance,
};
