const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment } = require("./trust-persistence.service");

const PLAN_CREATE_POLICY = "sst.emergency_plan.create@1";
const PLAN_TRANSITION_POLICY = "sst.emergency_plan.transition@1";
const DRILL_RECORD_POLICY = "sst.emergency_drill.record@1";

function validIdempotency(value) { return Boolean(value && String(value).trim().length >= 8); }

registerPolicy("sst.emergency_plan.create", "1", ({ input, idempotencyKey }) => {
  if (!String(input?.planCode || "").trim() || !String(input?.scenarioType || "").trim() || !String(input?.title || "").trim() || !String(input?.procedure || "").trim()) {
    return { allowed: false, statusCode: 400, reason: "Le code, le type de scénario, le titre et la procédure du plan sont requis." };
  }
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  return { allowed: true };
});

registerPolicy("sst.emergency_plan.transition", "1", ({ input, idempotencyKey }) => {
  if (!["activate", "retire"].includes(input?.action)) return { allowed: false, statusCode: 400, reason: "Transition de plan d’urgence invalide." };
  if (input.action === "retire" && !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, reason: "Une raison est obligatoire pour retirer un plan." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  return { allowed: true };
});

registerPolicy("sst.emergency_drill.record", "1", ({ input, idempotencyKey }) => {
  if (!input?.planId || !input?.conductedAt) return { allowed: false, statusCode: 400, reason: "Le plan et la date de l’exercice sont requis." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  return { allowed: true };
});

async function createEmergencyPlan({ organisationId, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "sst.emergency_plan.create",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [PLAN_CREATE_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM sst_emergency_plans WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) return { duplicate: true, plan: duplicate.rows[0] };

      const inserted = await client.query(
        `INSERT INTO sst_emergency_plans (organisation_id,plan_code,scenario_type,title,procedure,assembly_point,responsible_employee_id,review_due_at,evidence,ct_mad_transaction_id,correlation_id,created_by,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [orgId, String(input.planCode).trim(), String(input.scenarioType).trim(), String(input.title).trim(), String(input.procedure).trim(), input.assemblyPoint || null, input.responsibleEmployeeId || null, input.reviewDueAt || null, JSON.stringify(input.evidence || []), transactionId, correlationId, actorUserId || null, idempotencyKey],
      );
      const plan = inserted.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "sst.emergency_plan.created",
        aggregateType: "sst_emergency_plan",
        aggregateId: plan.id,
        actorUserId,
        correlationId,
        payload: { planCode: plan.plan_code, scenarioType: plan.scenario_type },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "sst.emergency_plan_procedure_present", passed: Boolean(plan.procedure), evidence: [{ planCode: plan.plan_code }] }],
      });
      return { duplicate: false, plan, event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function transitionEmergencyPlan({ organisationId, planId, input = {}, idempotencyKey, createdBy }) {
  const action = input.action;
  const tx = await executeTransaction({
    type: "sst.emergency_plan.transition",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [PLAN_TRANSITION_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const current = await client.query("SELECT * FROM sst_emergency_plans WHERE organisation_id=$1 AND id=$2", [orgId, planId]);
      if (!current.rows[0]) return null;
      const plan = current.rows[0];

      if (action === "activate" && plan.status !== "draft") {
        throw Object.assign(new Error("Seul un plan à l’état brouillon peut être activé."), { statusCode: 409 });
      }
      if (action === "retire" && plan.status !== "active") {
        throw Object.assign(new Error("Seul un plan actif peut être retiré."), { statusCode: 409 });
      }

      const nextStatus = action === "activate" ? "active" : "retired";
      const reviewedAt = action === "activate" ? new Date() : plan.last_reviewed_at;
      const { rows } = await client.query(
        `UPDATE sst_emergency_plans SET status=$1, last_reviewed_at=$2, ct_mad_transaction_id=$3, correlation_id=$4, updated_at=NOW() WHERE organisation_id=$5 AND id=$6 RETURNING *`,
        [nextStatus, reviewedAt, transactionId, correlationId, orgId, planId],
      );
      const updated = rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: `sst.emergency_plan.${action}d`,
        aggregateType: "sst_emergency_plan",
        aggregateId: updated.id,
        actorUserId,
        correlationId,
        payload: { action, reason: input.reason || null },
      });
      return { plan: updated, event };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function recordEmergencyDrill({ organisationId, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "sst.emergency_drill.record",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [DRILL_RECORD_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM sst_emergency_drills WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) return { duplicate: true, drill: duplicate.rows[0] };

      const plan = await client.query("SELECT * FROM sst_emergency_plans WHERE organisation_id=$1 AND id=$2", [orgId, input.planId]);
      if (!plan.rows[0]) throw Object.assign(new Error("Plan d’urgence introuvable."), { statusCode: 404 });
      if (plan.rows[0].status !== "active") throw Object.assign(new Error("Seul un exercice contre un plan actif peut être enregistré."), { statusCode: 409 });

      const inserted = await client.query(
        `INSERT INTO sst_emergency_drills (organisation_id,plan_id,conducted_at,participants_count,observations,evidence,ct_mad_transaction_id,correlation_id,created_by,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [orgId, input.planId, input.conductedAt, input.participantsCount || null, input.observations || null, JSON.stringify(input.evidence || []), transactionId, correlationId, actorUserId || null, idempotencyKey],
      );
      const drill = inserted.rows[0];
      await client.query("UPDATE sst_emergency_plans SET last_drill_at=$1, updated_at=NOW() WHERE organisation_id=$2 AND id=$3", [input.conductedAt, orgId, input.planId]);
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "sst.emergency_drill.recorded",
        aggregateType: "sst_emergency_drill",
        aggregateId: drill.id,
        actorUserId,
        correlationId,
        payload: { planId: input.planId, conductedAt: drill.conducted_at },
      });
      return { duplicate: false, drill, event };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

module.exports = {
  PLAN_CREATE_POLICY,
  PLAN_TRANSITION_POLICY,
  DRILL_RECORD_POLICY,
  createEmergencyPlan,
  transitionEmergencyPlan,
  recordEmergencyDrill,
};
