const express = require('express');
const db = require('../../../db');
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
require('../../services/business/cybersecurity-governance-transaction.service');

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

router.get('/assets', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM cybersecurity_assets WHERE organisation_id=$1 ORDER BY created_at DESC',[org(req)])).rows));
router.post('/assets', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'cybersecurity.asset.create', 'cybersecurity.asset.create', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO cybersecurity_assets (organisation_id,asset_number,name,asset_type,owner_user_id,confidentiality,integrity_requirement,availability_requirement,criticality,next_review_at,evidence,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[organisationId,input.assetNumber,input.name,input.assetType,input.ownerUserId,input.confidentiality||'internal',input.integrityRequirement||'medium',input.availabilityRequirement||'medium',input.criticality||'medium',input.nextReviewAt,input.evidence||[],idempotencyKey,actor(req)])).rows[0]);
},201));

router.get('/controls', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM cybersecurity_controls WHERE organisation_id=$1 ORDER BY created_at DESC',[org(req)])).rows));
router.post('/controls', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'cybersecurity.control.create', null, input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO cybersecurity_controls (organisation_id,asset_id,control_number,control_family,title,description,owner_user_id,verification_frequency,next_verification_at,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[organisationId,input.assetId||null,input.controlNumber,input.controlFamily,input.title,input.description,input.ownerUserId,input.verificationFrequency||null,input.nextVerificationAt||null,input.evidence||[],idempotencyKey])).rows[0]);
},201));
router.post('/controls/:id/verify', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, controlId: req.params.id };
  return transactionalWrite(req, 'cybersecurity.control.verify', 'cybersecurity.control.verify', input, async ({ client, organisationId }) => (await client.query(`UPDATE cybersecurity_controls SET implementation_status='verified',last_verified_at=NOW(),next_verification_at=$1,evidence=$2,result=$3,updated_at=NOW() WHERE id=$4 AND organisation_id=$5 RETURNING *`,[input.nextVerificationAt,input.evidence||[],input.result,req.params.id,organisationId])).rows[0]);
}));

router.get('/vulnerabilities', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM cybersecurity_vulnerabilities WHERE organisation_id=$1 ORDER BY detected_at DESC',[org(req)])).rows));
router.post('/vulnerabilities', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'cybersecurity.vulnerability.create', null, input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO cybersecurity_vulnerabilities (organisation_id,asset_id,vulnerability_number,title,description,severity,source,due_at,owner_user_id,remediation_plan,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[organisationId,input.assetId||null,input.vulnerabilityNumber,input.title,input.description,input.severity,input.source,input.dueAt||null,input.ownerUserId,input.remediationPlan||null,input.evidence||[],idempotencyKey])).rows[0]);
},201));
router.post('/vulnerabilities/:id/transition', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, vulnerabilityId: req.params.id };
  return transactionalWrite(req, 'cybersecurity.vulnerability.transition', 'cybersecurity.vulnerability.transition', input, async ({ client, organisationId }) => {
    const vulnerability = (await client.query('SELECT id,status,remediation_plan,evidence FROM cybersecurity_vulnerabilities WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[req.params.id,organisationId])).rows[0];
    if (!vulnerability) {
      const error = new Error('cybersecurity.vulnerability_not_found');
      error.statusCode = 404;
      throw error;
    }
    return (await client.query(`UPDATE cybersecurity_vulnerabilities SET status=$1,remediation_plan=COALESCE($2,remediation_plan),acceptance_reason=COALESCE($3,acceptance_reason),evidence=CASE WHEN $4::jsonb='[]'::jsonb THEN evidence ELSE evidence || $4::jsonb END,updated_at=NOW() WHERE id=$5 AND organisation_id=$6 RETURNING *`,[input.action,input.remediationPlan||null,input.acceptanceReason||null,JSON.stringify(input.evidence||[]),req.params.id,organisationId])).rows[0];
  });
}));

router.get('/incidents', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM cybersecurity_incidents WHERE organisation_id=$1 ORDER BY occurred_at DESC',[org(req)])).rows));
router.post('/incidents', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'cybersecurity.incident.record', 'cybersecurity.incident.record', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO cybersecurity_incidents (organisation_id,incident_number,title,description,severity,occurred_at,owner_user_id,affected_assets,decision_log,containment_actions,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[organisationId,input.incidentNumber,input.title,input.description,input.severity,input.occurredAt,input.ownerUserId,input.affectedAssets||[],input.decisionLog||[],input.containmentActions||[],input.evidence||[],idempotencyKey])).rows[0]);
},201));
router.post('/incidents/:id/close', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, incidentId: req.params.id };
  return transactionalWrite(req, 'cybersecurity.incident.close', 'cybersecurity.incident.close', input, async ({ client, organisationId }) => (await client.query(`UPDATE cybersecurity_incidents SET status='closed',root_cause=$1,lessons_learned=$2,evidence=$3,updated_at=NOW() WHERE id=$4 AND organisation_id=$5 RETURNING *`,[input.rootCause,input.lessonsLearned,input.evidence||[],req.params.id,organisationId])).rows[0]);
}));

router.get('/access-reviews', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM cybersecurity_access_reviews WHERE organisation_id=$1 ORDER BY reviewed_at DESC',[org(req)])).rows));
router.post('/access-reviews', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, reviewerUserId: req.body.reviewerUserId || actor(req) };
  return transactionalWrite(req, 'cybersecurity.access_review.complete', 'cybersecurity.access_review.complete', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO cybersecurity_access_reviews (organisation_id,review_number,scope,reviewer_user_id,conclusion,exceptions,remediation_actions,evidence,next_review_at,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,input.reviewNumber,input.scope,input.reviewerUserId,input.conclusion,input.exceptions||[],input.remediationActions||[],input.evidence||[],input.nextReviewAt,idempotencyKey])).rows[0]);
},201));

router.get('/exercises', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM cybersecurity_exercises WHERE organisation_id=$1 ORDER BY performed_at DESC',[org(req)])).rows));
router.post('/exercises', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'cybersecurity.exercise.record', 'cybersecurity.exercise.record', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO cybersecurity_exercises (organisation_id,exercise_number,exercise_type,scenario,owner_user_id,result,conclusion,improvement_actions,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,input.exerciseNumber,input.exerciseType,input.scenario,input.ownerUserId,input.result,input.conclusion,input.improvementActions||[],input.evidence||[],idempotencyKey])).rows[0]);
},201));

router.get('/alerts', (req,res,next) => handle(res,next,async () => (await db.query(`SELECT 'asset_review' AS alert_type,id,asset_number AS reference,next_review_at AS due_at FROM cybersecurity_assets WHERE organisation_id=$1 AND next_review_at<=NOW() AND status='active' UNION ALL SELECT 'control_verification',id,control_number,next_verification_at FROM cybersecurity_controls WHERE organisation_id=$1 AND next_verification_at IS NOT NULL AND next_verification_at<=NOW() AND implementation_status NOT IN ('retired') UNION ALL SELECT 'vulnerability_due',id,vulnerability_number,due_at FROM cybersecurity_vulnerabilities WHERE organisation_id=$1 AND due_at IS NOT NULL AND due_at<=NOW() AND status NOT IN ('mitigated','accepted','closed') ORDER BY due_at`,[org(req)])).rows));

module.exports = router;
