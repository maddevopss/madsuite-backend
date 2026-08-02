const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment } = require("./trust-persistence.service");
const { transitionReview, evaluateReviewClosure } = require("./hr-complete-block.service");

const REVIEW_CREATE_POLICY = "hr.performance_review.create@1";
const REVIEW_TRANSITION_POLICY = "hr.performance_review.transition@1";

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("hr.performance_review.create", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  if (!input?.employeeId || !input?.periodStart || !input?.periodEnd) return { allowed: false, statusCode: 400, reason: "Employé et période sont requis." };
  if (new Date(input.periodEnd) < new Date(input.periodStart)) return { allowed: false, statusCode: 400, reason: "La période de fin ne peut pas précéder la période de début." };
  return { allowed: true };
});

registerPolicy("hr.performance_review.transition", "1", ({ input, idempotencyKey }) => {
  if (!input?.reviewId || !input?.action || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Évaluation, action et clé d’idempotence sont requises." };
  return { allowed: true };
});

async function createPerformanceReview({ organisationId, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.performance_review.create",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [REVIEW_CREATE_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM hr_performance_reviews WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) return { duplicate: true, review: duplicate.rows[0] };

      const employee = await client.query("SELECT id FROM hr_employees WHERE organisation_id=$1 AND id=$2", [orgId, input.employeeId]);
      if (!employee.rows[0]) throw Object.assign(new Error("Employé introuvable."), { statusCode: 404 });

      const inserted = await client.query(
        `INSERT INTO hr_performance_reviews (organisation_id,employee_id,reviewer_user_id,period_start,period_end,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [orgId, input.employeeId, input.reviewerUserId || actorUserId || null, input.periodStart, input.periodEnd, idempotencyKey],
      );
      const review = inserted.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "hr.performance_review.created",
        aggregateType: "hr_performance_review",
        aggregateId: review.id,
        actorUserId,
        correlationId,
        payload: { employeeId: review.employee_id, periodStart: review.period_start, periodEnd: review.period_end },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "hr.review_period_valid", passed: true, evidence: [{ periodStart: review.period_start, periodEnd: review.period_end }] }],
      });
      return { duplicate: false, review, event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

// Les champs modifiables lors d'une transition sont fusionnés avec la ligne
// existante avant d'évaluer transitionReview()/evaluateReviewClosure() : une
// évaluation peut recevoir ses objectifs/compétences/commentaires/note à
// n'importe quelle étape du cycle, pas seulement à la création.
function mergeReviewFields(existing, input = {}) {
  return {
    employeeComments: input.employeeComments !== undefined ? input.employeeComments : existing.employee_comments,
    managerComments: input.managerComments !== undefined ? input.managerComments : existing.manager_comments,
    overallRating: input.overallRating !== undefined ? input.overallRating : existing.overall_rating,
    objectives: input.objectives !== undefined ? input.objectives : existing.objectives,
    competencies: input.competencies !== undefined ? input.competencies : existing.competencies,
  };
}

async function transitionPerformanceReview({ organisationId, reviewId, action, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.performance_review.transition",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [REVIEW_TRANSITION_POLICY],
    input: { ...input, reviewId, action },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM hr_performance_review_transitions WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) {
        const review = await client.query("SELECT * FROM hr_performance_reviews WHERE organisation_id=$1 AND id=$2", [orgId, duplicate.rows[0].review_id]);
        return { duplicate: true, review: review.rows[0], transition: duplicate.rows[0] };
      }

      const locked = await client.query("SELECT * FROM hr_performance_reviews WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [orgId, reviewId]);
      const review = locked.rows[0];
      if (!review) return null;

      // Lève une erreur explicite si la transition n'est pas permise depuis le statut courant.
      const newStatus = transitionReview(review.status, action);
      const merged = mergeReviewFields(review, input);

      if (newStatus === "closed") {
        const closure = evaluateReviewClosure(merged);
        if (!closure.complete) {
          throw Object.assign(new Error("La fermeture exige une note, au moins un objectif et une compétence évalués."), { statusCode: 409 });
        }
      }

      // acknowledged_at/closed_at sont calculés côté JS (plutôt qu'un CASE WHEN
      // SQL réutilisant $1) : une fois passée à 'acknowledged' puis 'closed',
      // la date d'accusé de réception doit être préservée, pas réévaluée à
      // chaque transition suivante.
      const acknowledgedAt = newStatus === "acknowledged" ? new Date().toISOString() : review.acknowledged_at;
      const closedAt = newStatus === "closed" ? new Date().toISOString() : review.closed_at;

      const updated = await client.query(
        `UPDATE hr_performance_reviews SET
           status=$1, employee_comments=$2, manager_comments=$3, overall_rating=$4,
           objectives=$5, competencies=$6, acknowledged_at=$7, closed_at=$8, updated_at=NOW()
         WHERE organisation_id=$9 AND id=$10 RETURNING *`,
        [newStatus, merged.employeeComments, merged.managerComments, merged.overallRating, JSON.stringify(merged.objectives || []), JSON.stringify(merged.competencies || []), acknowledgedAt, closedAt, orgId, reviewId],
      );
      const next = updated.rows[0];

      const transition = await client.query(
        `INSERT INTO hr_performance_review_transitions (organisation_id,review_id,action,previous_status,new_status,actor_user_id,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [orgId, reviewId, action, review.status, newStatus, actorUserId || null, idempotencyKey],
      );

      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: `hr.performance_review.${newStatus}`,
        aggregateType: "hr_performance_review",
        aggregateId: reviewId,
        actorUserId,
        correlationId,
        payload: { previousStatus: review.status, newStatus, action },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "hr.review_transition_recorded", passed: true, evidence: [{ transitionId: transition.rows[0].id, action }] }],
      });
      return { duplicate: false, review: next, transition: transition.rows[0], event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

module.exports = {
  REVIEW_CREATE_POLICY,
  REVIEW_TRANSITION_POLICY,
  createPerformanceReview,
  transitionPerformanceReview,
};
