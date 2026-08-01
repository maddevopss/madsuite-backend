const express = require('express');
const db = require('../../../db');
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
require('../../services/business/enterprise-business-continuity-transaction.service');

const router = express.Router();
router.use(requireOrganisation);
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

async function transactionalWrite(req, type, policy, input, execute) {
  const transaction = await executeTransaction({ type, organisationId: org(req), actorUserId: actor(req), idempotencyKey: key(req), policies: policy ? [`${policy}@1`] : [], input, execute });
  return transaction.result;
}

router.get('/processes', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM enterprise_business_processes WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/processes', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'continuity.process.create', 'continuity.process.create', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_business_processes (organisation_id,process_number,name,description,owner_user_id,criticality,maximum_tolerable_downtime_minutes,recovery_time_objective_minutes,recovery_point_objective_minutes,status,next_review_at,evidence,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [organisationId,input.processNumber,input.name,input.description,input.ownerUserId,input.criticality||'high',input.maximumTolerableDowntimeMinutes,input.recoveryTimeObjectiveMinutes,input.recoveryPointObjectiveMinutes??null,input.status||'active',input.nextReviewAt,input.evidence||[],idempotencyKey,actor(req)])).rows[0]);
}, 201));

router.get('/dependencies', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM enterprise_process_dependencies WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/dependencies', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'continuity.dependency.create', null, input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_process_dependencies (organisation_id,process_id,dependency_type,dependency_reference,description,criticality,fallback_description,owner_user_id,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [organisationId,input.processId,input.dependencyType,input.dependencyReference,input.description,input.criticality||'high',input.fallbackDescription||null,input.ownerUserId,input.evidence||[],idempotencyKey])).rows[0]);
}, 201));

router.get('/plans', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM enterprise_continuity_plans WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/plans', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'continuity.plan.create', 'continuity.plan.create', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_continuity_plans (organisation_id,process_id,plan_number,title,scenario,activation_conditions,owner_user_id,procedures,resources,evidence,status,next_review_at,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [organisationId,input.processId,input.planNumber,input.title,input.scenario,input.activationConditions,input.ownerUserId,input.procedures||[],input.resources||[],input.evidence||[],input.status||'draft',input.nextReviewAt,idempotencyKey])).rows[0]);
}, 201));
router.post('/plans/:id/activate', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, planId: req.params.id };
  return transactionalWrite(req, 'continuity.plan.activate', 'continuity.plan.activate', input, async ({ client, organisationId }) => (await client.query(`UPDATE enterprise_continuity_plans SET status='active', evidence=evidence || $3::jsonb, updated_at=NOW() WHERE id=$1 AND organisation_id=$2 RETURNING *`, [req.params.id,organisationId,JSON.stringify(input.evidence||[])])).rows[0]);
}));

router.get('/procedures', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM enterprise_recovery_procedures WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/procedures', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, responsibleUserId: req.body.responsibleUserId || actor(req) };
  return transactionalWrite(req, 'continuity.procedure.create', null, input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_recovery_procedures (organisation_id,plan_id,procedure_number,title,steps,responsible_user_id,expected_duration_minutes,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [organisationId,input.planId,input.procedureNumber,input.title,input.steps||[],input.responsibleUserId,input.expectedDurationMinutes||null,input.evidence||[],input.status||'draft',idempotencyKey])).rows[0]);
}, 201));

router.get('/exercises', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM enterprise_continuity_exercises WHERE organisation_id=$1 ORDER BY executed_at DESC', [org(req)])).rows));
router.post('/exercises', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'continuity.exercise.record', 'continuity.exercise.record', req.body, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_continuity_exercises (organisation_id,plan_id,exercise_number,scenario,executed_at,result,conclusion,observations,improvements,evidence,executed_by,idempotency_key) VALUES ($1,$2,$3,$4,COALESCE($5,NOW()),$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [organisationId,req.body.planId,req.body.exerciseNumber,req.body.scenario,req.body.executedAt||null,req.body.result,req.body.conclusion,req.body.observations||[],req.body.improvements||[],req.body.evidence||[],actor(req),idempotencyKey])).rows[0]), 201));

router.get('/events', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM enterprise_major_events WHERE organisation_id=$1 ORDER BY started_at DESC', [org(req)])).rows));
router.post('/events', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'continuity.event.record', 'continuity.event.record', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_major_events (organisation_id,plan_id,event_number,title,description,severity,started_at,status,decision_log,evidence,owner_user_id,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,NOW()),$8,$9,$10,$11,$12) RETURNING *`, [organisationId,input.planId||null,input.eventNumber,input.title,input.description,input.severity||'high',input.startedAt||null,input.status||'active',input.decisionLog||[],input.evidence||[],input.ownerUserId,idempotencyKey])).rows[0]);
}, 201));
router.post('/events/:id/close', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, eventId: req.params.id };
  return transactionalWrite(req, 'continuity.event.close', 'continuity.event.close', input, async ({ client, organisationId }) => (await client.query(`UPDATE enterprise_major_events SET status='closed', ended_at=COALESCE($3,NOW()), lessons_learned=$4, evidence=evidence || $5::jsonb, updated_at=NOW() WHERE id=$1 AND organisation_id=$2 RETURNING *`, [req.params.id,organisationId,input.endedAt||null,input.lessonsLearned,JSON.stringify(input.evidence||[])])).rows[0]);
}));

router.get('/reviews', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM enterprise_continuity_reviews WHERE organisation_id=$1 ORDER BY reviewed_at DESC', [org(req)])).rows));
router.post('/reviews', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, reviewerUserId: req.body.reviewerUserId || actor(req) };
  return transactionalWrite(req, 'continuity.review.complete', 'continuity.review.complete', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_continuity_reviews (organisation_id,plan_id,review_number,reviewer_user_id,reviewed_at,conclusion,evidence,next_review_at,idempotency_key) VALUES ($1,$2,$3,$4,COALESCE($5,NOW()),$6,$7,$8,$9) RETURNING *`, [organisationId,input.planId,input.reviewNumber,input.reviewerUserId,input.reviewedAt||null,input.conclusion,input.evidence||[],input.nextReviewAt,idempotencyKey])).rows[0]);
}, 201));

router.get('/alerts', (req, res, next) => handle(res, next, async () => (await db.query(`SELECT 'process_review' AS alert_type,id,process_number AS reference,next_review_at AS due_at FROM enterprise_business_processes WHERE organisation_id=$1 AND next_review_at<=NOW() AND status='active' UNION ALL SELECT 'plan_review',id,plan_number,next_review_at FROM enterprise_continuity_plans WHERE organisation_id=$1 AND next_review_at<=NOW() AND status IN ('approved','active') ORDER BY due_at`, [org(req)])).rows));

module.exports = router;
