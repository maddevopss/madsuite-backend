const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
const institutionalRiskLinksRoutes = require('./institutional-risk-links.routes');
require('../../services/business/enterprise-risk-transaction.service');

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

function notFound(code) {
  const error = new Error(code);
  error.statusCode = 404;
  return error;
}

router.get('/', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risks WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req), likelihood: Number(req.body.likelihood), impact: Number(req.body.impact) };
  return transactionalWrite(req, 'risk.register.create', 'risk.register.create', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_risks (organisation_id,risk_number,category,title,description,source_type,source_id,owner_user_id,likelihood,impact,inherent_score,appetite_threshold,next_review_at,evidence,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [organisationId,input.riskNumber,input.category,input.title,input.description,input.sourceType||null,input.sourceId||null,input.ownerUserId,input.likelihood,input.impact,input.likelihood*input.impact,input.appetiteThreshold||null,input.nextReviewAt||null,input.evidence||[],idempotencyKey,actor(req)])).rows[0]);
}, 201));

router.get('/assessments', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risk_assessments WHERE organisation_id=$1 ORDER BY assessed_at DESC', [org(req)])).rows));
router.post('/assessments', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, likelihood: Number(req.body.likelihood), impact: Number(req.body.impact), controlEffectiveness: Number(req.body.controlEffectiveness || 0) };
  return transactionalWrite(req, 'risk.assessment.record', 'risk.assessment.record', input, async ({ client, organisationId, idempotencyKey }) => {
    const inherent = input.likelihood * input.impact;
    const residual = Number((inherent * (1 - input.controlEffectiveness / 100)).toFixed(2));
    return (await client.query(`INSERT INTO enterprise_risk_assessments (organisation_id,risk_id,likelihood,impact,inherent_score,control_effectiveness,residual_score,conclusion,evidence,assessed_by,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [organisationId,input.riskId,input.likelihood,input.impact,inherent,input.controlEffectiveness,residual,input.conclusion,input.evidence||[],actor(req),idempotencyKey])).rows[0];
  });
}, 201));

router.get('/controls', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risk_controls WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/controls', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  const policy = ['active', 'retired'].includes(input.status) ? 'risk.control.transition' : null;
  return transactionalWrite(req, 'risk.control.create', policy, { ...input, action: input.status }, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_risk_controls (organisation_id,risk_id,control_number,objective,description,owner_user_id,frequency,effectiveness,status,verification_evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [organisationId,input.riskId,input.controlNumber,input.objective,input.description,input.ownerUserId,input.frequency||null,input.effectiveness||0,input.status||'planned',input.verificationEvidence||[],idempotencyKey])).rows[0]);
}, 201));
router.post('/controls/:id/transition', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, controlId: req.params.id };
  return transactionalWrite(req, 'risk.control.transition', 'risk.control.transition', input, async ({ client, organisationId }) => {
    const current = (await client.query('SELECT id,status FROM enterprise_risk_controls WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [req.params.id,organisationId])).rows[0];
    if (!current) throw notFound('risk.control_not_found');
    return (await client.query(`UPDATE enterprise_risk_controls SET status=$1,effectiveness=COALESCE($2,effectiveness),verification_evidence=CASE WHEN $3::jsonb='[]'::jsonb THEN verification_evidence ELSE $3::jsonb END,last_verified_at=CASE WHEN $1='active' THEN NOW() ELSE last_verified_at END,reason=COALESCE($4,reason),updated_at=NOW() WHERE id=$5 AND organisation_id=$6 RETURNING *`, [input.action,input.effectiveness??null,JSON.stringify(input.verificationEvidence||[]),input.reason||null,req.params.id,organisationId])).rows[0];
  });
}));

router.get('/treatments', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risk_treatments WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/treatments', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  const policy = ['implemented','verified','closed','cancelled'].includes(input.status) ? 'risk.treatment.transition' : null;
  return transactionalWrite(req, 'risk.treatment.create', policy, { ...input, action: input.status }, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_risk_treatments (organisation_id,risk_id,treatment_number,strategy,description,owner_user_id,due_at,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [organisationId,input.riskId,input.treatmentNumber,input.strategy,input.description,input.ownerUserId,input.dueAt||null,input.evidence||[],idempotencyKey])).rows[0]);
}, 201));
router.post('/treatments/:id/transition', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, treatmentId: req.params.id };
  return transactionalWrite(req, 'risk.treatment.transition', 'risk.treatment.transition', input, async ({ client, organisationId }) => {
    const current = (await client.query('SELECT id,status FROM enterprise_risk_treatments WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [req.params.id,organisationId])).rows[0];
    if (!current) throw notFound('risk.treatment_not_found');
    return (await client.query(`UPDATE enterprise_risk_treatments SET status=$1,result=COALESCE($2,result),evidence=CASE WHEN $3::jsonb='[]'::jsonb THEN evidence ELSE evidence || $3::jsonb END,reason=COALESCE($4,reason),updated_at=NOW() WHERE id=$5 AND organisation_id=$6 RETURNING *`, [input.action,input.result||null,JSON.stringify(input.evidence||[]),input.reason||null,req.params.id,organisationId])).rows[0];
  });
}));

router.get('/reviews', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risk_reviews WHERE organisation_id=$1 ORDER BY reviewed_at DESC', [org(req)])).rows));
router.post('/reviews', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, reviewerUserId: req.body.reviewerUserId || actor(req) };
  const policy = ['approved','closed'].includes(input.status) ? 'risk.review.transition' : null;
  return transactionalWrite(req, 'risk.review.create', policy, { ...input, action: input.status }, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_risk_reviews (organisation_id,risk_id,review_number,reviewer_user_id,likelihood,impact,residual_score,conclusion,evidence,status,next_review_at,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [organisationId,input.riskId,input.reviewNumber,input.reviewerUserId,input.likelihood||null,input.impact||null,input.residualScore||null,input.conclusion||null,input.evidence||[],input.status||'draft',input.nextReviewAt||null,idempotencyKey])).rows[0]);
}, 201));
router.post('/reviews/:id/transition', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, reviewId: req.params.id };
  return transactionalWrite(req, 'risk.review.transition', 'risk.review.transition', input, async ({ client, organisationId }) => {
    const current = (await client.query('SELECT id,status FROM enterprise_risk_reviews WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [req.params.id,organisationId])).rows[0];
    if (!current) throw notFound('risk.review_not_found');
    return (await client.query(`UPDATE enterprise_risk_reviews SET status=$1,conclusion=COALESCE($2,conclusion),evidence=CASE WHEN $3::jsonb='[]'::jsonb THEN evidence ELSE evidence || $3::jsonb END,next_review_at=COALESCE($4,next_review_at) WHERE id=$5 AND organisation_id=$6 RETURNING *`, [input.action,input.conclusion||null,JSON.stringify(input.evidence||[]),input.nextReviewAt||null,req.params.id,organisationId])).rows[0];
  });
}));

router.get('/incidents', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risk_incidents WHERE organisation_id=$1 ORDER BY occurred_at DESC', [org(req)])).rows));
router.post('/incidents', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'risk.incident.record', 'risk.incident.record', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO enterprise_risk_incidents (organisation_id,risk_id,incident_number,source_type,source_id,occurred_at,title,description,severity,impact_summary,evidence,owner_user_id,idempotency_key) VALUES ($1,$2,$3,$4,$5,COALESCE($6,NOW()),$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [organisationId,input.riskId||null,input.incidentNumber,input.sourceType,input.sourceId||null,input.occurredAt||null,input.title,input.description,input.severity||'medium',input.impactSummary||null,input.evidence||[],input.ownerUserId,idempotencyKey])).rows[0]);
}, 201));

router.use('/institutional-links', institutionalRiskLinksRoutes);

router.get('/alerts', (req, res, next) => handle(res, next, async () => (await db.pool.query(`SELECT 'risk_review' AS alert_type,id,risk_number AS reference,next_review_at AS due_at FROM enterprise_risks WHERE organisation_id=$1 AND next_review_at IS NOT NULL AND next_review_at <= NOW() AND status NOT IN ('closed','cancelled') UNION ALL SELECT 'treatment_due',id,treatment_number,due_at FROM enterprise_risk_treatments WHERE organisation_id=$1 AND due_at IS NOT NULL AND due_at <= NOW() AND status NOT IN ('closed','cancelled') ORDER BY due_at`, [org(req)])).rows));

module.exports = router;
