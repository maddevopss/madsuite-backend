const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
require('../../services/business/data-privacy-governance-transaction.service');

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

async function transactionalWrite(req, type, policy, input, execute) {
  const transaction = await executeTransaction({ type, organisationId: org(req), actorUserId: actor(req), idempotencyKey: key(req), policies: [`${policy}@1`], input, execute });
  return transaction.result;
}

router.get('/processing-activities', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM privacy_processing_activities WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/processing-activities', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'privacy.processing.create', 'privacy.processing.create', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO privacy_processing_activities (organisation_id,activity_number,name,purpose,legal_basis,data_categories,subject_categories,recipients,retention_period_days,owner_user_id,status,next_review_at,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [organisationId,input.activityNumber,input.name,input.purpose,input.legalBasis,input.dataCategories||[],input.subjectCategories||[],input.recipients||[],input.retentionPeriodDays,input.ownerUserId,input.status||'active',input.nextReviewAt,input.evidence||[],idempotencyKey])).rows[0]);
}, 201));

router.get('/consents', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM privacy_consents WHERE organisation_id=$1 ORDER BY collected_at DESC', [org(req)])).rows));
router.post('/consents', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, status: req.body.status || 'granted' };
  return transactionalWrite(req, 'privacy.consent.record', 'privacy.consent.record', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO privacy_consents (organisation_id,subject_reference,purpose,status,collected_at,withdrawn_at,source,proof,idempotency_key) VALUES ($1,$2,$3,$4,COALESCE($5,NOW()),$6,$7,$8,$9) RETURNING *`, [organisationId,input.subjectReference,input.purpose,input.status,input.collectedAt||null,input.withdrawnAt||null,input.source,input.proof||[],idempotencyKey])).rows[0]);
}, 201));

router.get('/requests', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM privacy_subject_requests WHERE organisation_id=$1 ORDER BY received_at DESC', [org(req)])).rows));
router.post('/requests', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req), status: req.body.status || 'open' };
  return transactionalWrite(req, 'privacy.subject_request.transition', 'privacy.subject_request.transition', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO privacy_subject_requests (organisation_id,request_number,request_type,subject_reference,due_at,owner_user_id,status,identity_verification,response_summary,evidence,refusal_reason,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [organisationId,input.requestNumber,input.requestType,input.subjectReference,input.dueAt,input.ownerUserId,input.status,input.identityVerification||[],input.responseSummary||null,input.evidence||[],input.refusalReason||null,idempotencyKey])).rows[0]);
}, 201));

router.get('/incidents', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM privacy_incidents WHERE organisation_id=$1 ORDER BY detected_at DESC', [org(req)])).rows));
router.post('/incidents', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'privacy.incident.record', 'privacy.incident.record', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO privacy_incidents (organisation_id,incident_number,title,description,severity,affected_data,affected_subjects_estimate,owner_user_id,containment_actions,decision_log,notification_required,notification_decision_reason,status,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [organisationId,input.incidentNumber,input.title,input.description,input.severity||'medium',input.affectedData||[],input.affectedSubjectsEstimate||0,input.ownerUserId,input.containmentActions||[],input.decisionLog||[],input.notificationRequired??null,input.notificationDecisionReason||null,input.status||'open',input.evidence||[],idempotencyKey])).rows[0]);
}, 201));
router.post('/incidents/:id/close', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, incidentId: req.params.id };
  return transactionalWrite(req, 'privacy.incident.close', 'privacy.incident.close', input, async ({ client, organisationId }) => (await client.query(`UPDATE privacy_incidents SET status='closed',root_cause=$1,lessons_learned=$2,evidence=$3,updated_at=NOW() WHERE id=$4 AND organisation_id=$5 RETURNING *`, [input.rootCause,input.lessonsLearned,input.evidence||[],req.params.id,organisationId])).rows[0]);
}));

router.get('/retention-actions', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM privacy_retention_actions WHERE organisation_id=$1 ORDER BY due_at', [org(req)])).rows));
router.post('/retention-actions', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, status: req.body.status || 'planned' };
  return transactionalWrite(req, 'privacy.retention.complete', 'privacy.retention.complete', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO privacy_retention_actions (organisation_id,processing_activity_id,action_number,action_type,due_at,completed_at,result,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [organisationId,input.processingActivityId,input.actionNumber,input.actionType,input.dueAt,input.completedAt||null,input.result||null,input.evidence||[],input.status,idempotencyKey])).rows[0]);
}, 201));

router.get('/alerts', (req, res, next) => handle(res, next, async () => (await db.pool.query(`SELECT 'processing_review' AS alert_type,id,activity_number AS reference,next_review_at AS due_at FROM privacy_processing_activities WHERE organisation_id=$1 AND status='active' AND next_review_at<=NOW() UNION ALL SELECT 'subject_request_due',id,request_number,due_at FROM privacy_subject_requests WHERE organisation_id=$1 AND status NOT IN ('completed','refused','cancelled') AND due_at<=NOW() UNION ALL SELECT 'retention_due',id,action_number,due_at FROM privacy_retention_actions WHERE organisation_id=$1 AND status NOT IN ('completed','cancelled') AND due_at<=NOW() ORDER BY due_at`, [org(req)])).rows));

module.exports = router;
