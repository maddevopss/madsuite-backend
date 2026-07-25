const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
require('../../services/business/advanced-document-governance-transaction.service');

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

async function transactionalWrite(req, type, policy, input, execute) {
  const transaction = await executeTransaction({ type, organisationId: org(req), actorUserId: actor(req), idempotencyKey: key(req), policies: policy ? [`${policy}@1`] : [], input, execute });
  return transaction.result;
}

router.get('/classifications', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM document_classifications WHERE organisation_id=$1 ORDER BY classification_code',[org(req)])).rows));
router.post('/classifications', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'documents.classification.create', 'documents.classification.create', input, async ({ client, organisationId }) => (await client.query(`INSERT INTO document_classifications (organisation_id,classification_code,name,sensitivity_level,retention_years,legal_hold_required,owner_user_id,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[organisationId,input.classificationCode,input.name,input.sensitivityLevel||'internal',input.retentionYears||null,input.legalHoldRequired||false,input.ownerUserId,input.evidence||[]])).rows[0]);
},201));

router.get('/documents', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governed_documents WHERE organisation_id=$1 ORDER BY updated_at DESC',[org(req)])).rows));
router.post('/documents', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, businessOwnerUserId: req.body.businessOwnerUserId || actor(req) };
  return transactionalWrite(req, 'documents.document.create', null, input, async ({ client, organisationId }) => (await client.query(`INSERT INTO governed_documents (organisation_id,classification_id,document_code,title,business_owner_user_id,current_version,status,effective_at,legal_hold,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,input.classificationId,input.documentCode,input.title,input.businessOwnerUserId,input.currentVersion||1,input.status||'draft',input.effectiveAt||null,input.legalHold||false,input.evidence||[]])).rows[0]);
},201));

router.get('/documents/:id/versions', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governed_document_versions WHERE organisation_id=$1 AND document_id=$2 ORDER BY version_number DESC',[org(req),req.params.id])).rows));
router.post('/documents/:id/versions', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, documentId: req.params.id, preparedByUserId: req.body.preparedByUserId || actor(req) };
  const policy = input.approvedByUserId ? 'documents.version.approve' : null;
  return transactionalWrite(req, 'documents.version.create', policy, input, async ({ client, organisationId }) => (await client.query(`INSERT INTO governed_document_versions (organisation_id,document_id,version_number,change_summary,content_hash,storage_ref,prepared_by_user_id,approved_by_user_id,approved_at,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,req.params.id,input.versionNumber,input.changeSummary,input.contentHash,input.storageRef,input.preparedByUserId,input.approvedByUserId||null,input.approvedAt||null,input.evidence||[]])).rows[0]);
},201));

router.get('/retention-actions', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM document_retention_actions WHERE organisation_id=$1 ORDER BY scheduled_at',[org(req)])).rows));
router.post('/retention-actions', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, requestedByUserId: req.body.requestedByUserId || actor(req) };
  return transactionalWrite(req, 'documents.retention.create', null, input, async ({ client, organisationId, idempotencyKey }) => {
    const document = (await client.query('SELECT legal_hold FROM governed_documents WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[input.documentId,organisationId])).rows[0];
    if (!document) return null;
    if (input.actionType === 'destroy' && document.legal_hold === true) { const error = new Error('documents.legal_hold_blocks_destruction'); error.statusCode = 409; throw error; }
    if (input.approvedByUserId && String(input.requestedByUserId) === String(input.approvedByUserId)) { const error = new Error('documents.retention_separation_of_duties_required'); error.statusCode = 409; throw error; }
    if (input.executedByUserId && String(input.approvedByUserId) === String(input.executedByUserId)) { const error = new Error('documents.retention_separation_of_duties_required'); error.statusCode = 409; throw error; }
    return (await client.query(`INSERT INTO document_retention_actions (organisation_id,document_id,action_type,scheduled_at,requested_by_user_id,approved_by_user_id,executed_by_user_id,executed_at,reason,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[organisationId,input.documentId,input.actionType,input.scheduledAt,input.requestedByUserId,input.approvedByUserId||null,input.executedByUserId||null,input.executedAt||null,input.reason,input.evidence||[],input.status||'pending',idempotencyKey])).rows[0];
  });
},201));

router.get('/access-reviews', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM document_access_reviews WHERE organisation_id=$1 ORDER BY reviewed_at DESC',[org(req)])).rows));
router.post('/access-reviews', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, reviewedByUserId: req.body.reviewedByUserId || actor(req) };
  return transactionalWrite(req, 'documents.access_review.complete', 'documents.access_review.complete', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO document_access_reviews (organisation_id,document_id,reviewed_by_user_id,reviewed_at,authorized_roles,findings,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[organisationId,input.documentId,input.reviewedByUserId,input.reviewedAt,input.authorizedRoles||[],input.findings||[],input.evidence||[],idempotencyKey])).rows[0]);
},201));

router.get('/alerts', (req,res,next) => handle(res,next,async () => (await db.pool.query(`SELECT 'retention_due' AS alert_type,id,document_id,scheduled_at AS due_at FROM document_retention_actions WHERE organisation_id=$1 AND status='pending' AND scheduled_at<=NOW()+INTERVAL '60 days' UNION ALL SELECT 'legal_hold' AS alert_type,id,id AS document_id,updated_at AS due_at FROM governed_documents WHERE organisation_id=$1 AND legal_hold=TRUE ORDER BY due_at`,[org(req)])).rows));

module.exports = router;
