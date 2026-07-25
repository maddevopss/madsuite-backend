const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
require('../../services/business/organizational-performance-transaction.service');

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

async function transactionalWrite(req, type, policy, input, execute) {
  const transaction = await executeTransaction({
    type,
    organisationId: org(req),
    actorUserId: actor(req),
    idempotencyKey: key(req),
    policies: policy ? [`${policy}@1`] : [],
    input,
    execute,
  });
  return transaction.result;
}

router.get('/objectives', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM performance_objectives WHERE organisation_id=$1 ORDER BY period_end DESC',[org(req)])).rows));
router.post('/objectives', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'performance.objective.create', 'performance.objective.create', input, async ({ client, organisationId }) => (await client.query(`INSERT INTO performance_objectives (organisation_id,objective_number,title,description,owner_user_id,parent_objective_id,perspective,status,priority,period_start,period_end,baseline,target,unit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[organisationId,input.objectiveNumber,input.title,input.description,input.ownerUserId,input.parentObjectiveId||null,input.perspective,input.status||'draft',input.priority||'medium',input.periodStart,input.periodEnd,input.baseline??null,input.target??null,input.unit||null])).rows[0]);
},201));
router.post('/objectives/:id/approve', (req,res,next) => handle(res,next,() => transactionalWrite(req, 'performance.objective.approve', null, { ...req.body, objectiveId: req.params.id }, async ({ client, organisationId }) => {
  const objective = (await client.query('SELECT owner_user_id FROM performance_objectives WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[req.params.id,organisationId])).rows[0];
  if (!objective) return null;
  const approvedByUserId = req.body.approvedByUserId || actor(req);
  if (String(objective.owner_user_id) === String(approvedByUserId)) {
    const error = new Error('performance.objective_independent_approval_required');
    error.statusCode = 409;
    throw error;
  }
  return (await client.query(`UPDATE performance_objectives SET status='active',approved_by_user_id=$1,approved_at=NOW(),updated_at=NOW() WHERE id=$2 AND organisation_id=$3 RETURNING *`,[approvedByUserId,req.params.id,organisationId])).rows[0];
})));

router.get('/indicators', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM performance_indicators WHERE organisation_id=$1 ORDER BY created_at DESC',[org(req)])).rows));
router.post('/indicators', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'performance.indicator.create', 'performance.indicator.create', input, async ({ client, organisationId }) => (await client.query(`INSERT INTO performance_indicators (organisation_id,objective_id,indicator_number,name,definition,formula,source_system,owner_user_id,direction,frequency,unit,baseline,target,warning_threshold,critical_threshold,tolerance_low,tolerance_high) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,[organisationId,input.objectiveId,input.indicatorNumber,input.name,input.definition,input.formula,input.sourceSystem,input.ownerUserId,input.direction,input.frequency,input.unit,input.baseline??null,input.target,input.warningThreshold??null,input.criticalThreshold??null,input.toleranceLow??null,input.toleranceHigh??null])).rows[0]);
},201));

router.get('/measurements', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM performance_measurements WHERE organisation_id=$1 ORDER BY measured_at DESC',[org(req)])).rows));
router.post('/measurements', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, measuredByUserId: req.body.measuredByUserId || actor(req) };
  return transactionalWrite(req, 'performance.measurement.record', 'performance.measurement.record', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO performance_measurements (organisation_id,indicator_id,measured_at,value,status,source_reference,evidence,measured_by_user_id,commentary,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,input.indicatorId,input.measuredAt,input.value,input.status,input.sourceReference,input.evidence||[],input.measuredByUserId,input.commentary||null,idempotencyKey])).rows[0]);
},201));

router.get('/reviews', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM performance_reviews WHERE organisation_id=$1 ORDER BY review_date DESC',[org(req)])).rows));
router.post('/reviews', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, reviewerUserId: req.body.reviewerUserId || actor(req) };
  return transactionalWrite(req, 'performance.review.complete', 'performance.review.complete', input, async ({ client, organisationId }) => (await client.query(`INSERT INTO performance_reviews (organisation_id,objective_id,review_number,review_date,reviewer_user_id,overall_status,analysis,decisions,evidence,next_review_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,input.objectiveId,input.reviewNumber,input.reviewDate,input.reviewerUserId,input.overallStatus,input.analysis,input.decisions||[],input.evidence||[],input.nextReviewAt||null])).rows[0]);
},201));

router.get('/improvement-plans', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM performance_improvement_plans WHERE organisation_id=$1 ORDER BY due_at',[org(req)])).rows));
router.post('/improvement-plans', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'performance.improvement.create', null, input, async ({ client, organisationId }) => (await client.query(`INSERT INTO performance_improvement_plans (organisation_id,objective_id,indicator_id,plan_number,title,root_cause,action_plan,owner_user_id,due_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[organisationId,input.objectiveId||null,input.indicatorId||null,input.planNumber,input.title,input.rootCause,input.actionPlan||[],input.ownerUserId,input.dueAt])).rows[0]);
},201));
router.post('/improvement-plans/:id/transition', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, planId: req.params.id };
  return transactionalWrite(req, 'performance.improvement.transition', 'performance.improvement.transition', input, async ({ client, organisationId }) => (await client.query(`UPDATE performance_improvement_plans SET status=$1,implementation_result=$2,implementation_evidence=$3,effectiveness_result=$4,verification_evidence=$5,verified_by_user_id=$6,verified_at=CASE WHEN $1 IN ('verified','closed') THEN NOW() ELSE verified_at END,closed_at=CASE WHEN $1='closed' THEN NOW() ELSE closed_at END,updated_at=NOW() WHERE id=$7 AND organisation_id=$8 RETURNING *`,[input.action,input.implementationResult||null,input.implementationEvidence||[],input.effectivenessResult||null,input.verificationEvidence||[],input.verifiedByUserId||null,req.params.id,organisationId])).rows[0]);
}));

router.get('/alerts', (req,res,next) => handle(res,next,async () => (await db.pool.query(`SELECT 'objective_at_risk' AS alert_type,id,objective_number AS reference,period_end AS due_at FROM performance_objectives WHERE organisation_id=$1 AND status='at_risk' UNION ALL SELECT 'improvement_overdue',id,plan_number,due_at FROM performance_improvement_plans WHERE organisation_id=$1 AND due_at<CURRENT_DATE AND status NOT IN ('verified','closed','cancelled') ORDER BY due_at`,[org(req)])).rows));

module.exports = router;
