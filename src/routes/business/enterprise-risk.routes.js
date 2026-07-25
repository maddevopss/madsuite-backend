const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
require('../../services/business/enterprise-risk-transaction.service');

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

router.get('/', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risks WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/', (req, res, next) => handle(res, next, async () => {
  const likelihood = Number(req.body.likelihood);
  const impact = Number(req.body.impact);
  return (await db.pool.query(`INSERT INTO enterprise_risks (organisation_id,risk_number,category,title,description,source_type,source_id,owner_user_id,likelihood,impact,inherent_score,appetite_threshold,next_review_at,evidence,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [org(req),req.body.riskNumber,req.body.category,req.body.title,req.body.description,req.body.sourceType||null,req.body.sourceId||null,req.body.ownerUserId,likelihood,impact,likelihood*impact,req.body.appetiteThreshold||null,req.body.nextReviewAt||null,req.body.evidence||[],key(req),actor(req)])).rows[0];
}, 201));

router.get('/assessments', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risk_assessments WHERE organisation_id=$1 ORDER BY assessed_at DESC', [org(req)])).rows));
router.post('/assessments', (req, res, next) => handle(res, next, async () => {
  const likelihood = Number(req.body.likelihood);
  const impact = Number(req.body.impact);
  const effectiveness = Number(req.body.controlEffectiveness || 0);
  const inherent = likelihood * impact;
  const residual = Number((inherent * (1 - effectiveness / 100)).toFixed(2));
  return (await db.pool.query(`INSERT INTO enterprise_risk_assessments (organisation_id,risk_id,likelihood,impact,inherent_score,control_effectiveness,residual_score,conclusion,evidence,assessed_by,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [org(req),req.body.riskId,likelihood,impact,inherent,effectiveness,residual,req.body.conclusion,req.body.evidence||[],actor(req),key(req)])).rows[0];
}, 201));

router.get('/controls', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risk_controls WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/controls', (req, res, next) => handle(res, next, async () => (await db.pool.query(`INSERT INTO enterprise_risk_controls (organisation_id,risk_id,control_number,objective,description,owner_user_id,frequency,effectiveness,status,verification_evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [org(req),req.body.riskId,req.body.controlNumber,req.body.objective,req.body.description,req.body.ownerUserId,req.body.frequency||null,req.body.effectiveness||0,req.body.status||'planned',req.body.verificationEvidence||[],key(req)])).rows[0], 201));

router.get('/treatments', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risk_treatments WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/treatments', (req, res, next) => handle(res, next, async () => (await db.pool.query(`INSERT INTO enterprise_risk_treatments (organisation_id,risk_id,treatment_number,strategy,description,owner_user_id,due_at,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [org(req),req.body.riskId,req.body.treatmentNumber,req.body.strategy,req.body.description,req.body.ownerUserId,req.body.dueAt||null,req.body.evidence||[],key(req)])).rows[0], 201));

router.get('/reviews', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risk_reviews WHERE organisation_id=$1 ORDER BY reviewed_at DESC', [org(req)])).rows));
router.post('/reviews', (req, res, next) => handle(res, next, async () => (await db.pool.query(`INSERT INTO enterprise_risk_reviews (organisation_id,risk_id,review_number,reviewer_user_id,likelihood,impact,residual_score,conclusion,evidence,status,next_review_at,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [org(req),req.body.riskId,req.body.reviewNumber,req.body.reviewerUserId||actor(req),req.body.likelihood||null,req.body.impact||null,req.body.residualScore||null,req.body.conclusion||null,req.body.evidence||[],req.body.status||'draft',req.body.nextReviewAt||null,key(req)])).rows[0], 201));

router.get('/incidents', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM enterprise_risk_incidents WHERE organisation_id=$1 ORDER BY occurred_at DESC', [org(req)])).rows));
router.post('/incidents', (req, res, next) => handle(res, next, async () => (await db.pool.query(`INSERT INTO enterprise_risk_incidents (organisation_id,risk_id,incident_number,source_type,source_id,occurred_at,title,description,severity,impact_summary,evidence,owner_user_id,idempotency_key) VALUES ($1,$2,$3,$4,$5,COALESCE($6,NOW()),$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [org(req),req.body.riskId||null,req.body.incidentNumber,req.body.sourceType,req.body.sourceId||null,req.body.occurredAt||null,req.body.title,req.body.description,req.body.severity||'medium',req.body.impactSummary||null,req.body.evidence||[],req.body.ownerUserId||actor(req),key(req)])).rows[0], 201));

router.get('/alerts', (req, res, next) => handle(res, next, async () => (await db.pool.query(`SELECT 'risk_review' AS alert_type,id,risk_number AS reference,next_review_at AS due_at FROM enterprise_risks WHERE organisation_id=$1 AND next_review_at IS NOT NULL AND next_review_at <= NOW() AND status NOT IN ('closed','cancelled') UNION ALL SELECT 'treatment_due',id,treatment_number,due_at FROM enterprise_risk_treatments WHERE organisation_id=$1 AND due_at IS NOT NULL AND due_at <= NOW() AND status NOT IN ('closed','cancelled') ORDER BY due_at`, [org(req)])).rows));

module.exports = router;
