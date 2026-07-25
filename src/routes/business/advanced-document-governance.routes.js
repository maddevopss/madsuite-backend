const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
require('../../services/business/advanced-document-governance-transaction.service');

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

router.get('/classifications', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM document_classifications WHERE organisation_id=$1 ORDER BY classification_code',[org(req)])).rows));
router.post('/classifications', (req,res,next) => handle(res,next,async () => (await db.pool.query(`INSERT INTO document_classifications (organisation_id,classification_code,name,sensitivity_level,retention_years,legal_hold_required,owner_user_id,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[org(req),req.body.classificationCode,req.body.name,req.body.sensitivityLevel||'internal',req.body.retentionYears||null,req.body.legalHoldRequired||false,req.body.ownerUserId,req.body.evidence||[]])).rows[0],201));

router.get('/documents', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governed_documents WHERE organisation_id=$1 ORDER BY updated_at DESC',[org(req)])).rows));
router.post('/documents', (req,res,next) => handle(res,next,async () => (await db.pool.query(`INSERT INTO governed_documents (organisation_id,classification_id,document_code,title,business_owner_user_id,current_version,status,effective_at,legal_hold,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[org(req),req.body.classificationId,req.body.documentCode,req.body.title,req.body.businessOwnerUserId,req.body.currentVersion||1,req.body.status||'draft',req.body.effectiveAt||null,req.body.legalHold||false,req.body.evidence||[]])).rows[0],201));

router.get('/documents/:id/versions', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governed_document_versions WHERE organisation_id=$1 AND document_id=$2 ORDER BY version_number DESC',[org(req),req.params.id])).rows));
router.post('/documents/:id/versions', (req,res,next) => handle(res,next,async () => (await db.pool.query(`INSERT INTO governed_document_versions (organisation_id,document_id,version_number,change_summary,content_hash,storage_ref,prepared_by_user_id,approved_by_user_id,approved_at,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[org(req),req.params.id,req.body.versionNumber,req.body.changeSummary,req.body.contentHash,req.body.storageRef,req.body.preparedByUserId,req.body.approvedByUserId||null,req.body.approvedAt||null,req.body.evidence||[]])).rows[0],201));

router.get('/retention-actions', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM document_retention_actions WHERE organisation_id=$1 ORDER BY scheduled_at',[org(req)])).rows));
router.post('/retention-actions', (req,res,next) => handle(res,next,async () => (await db.pool.query(`INSERT INTO document_retention_actions (organisation_id,document_id,action_type,scheduled_at,requested_by_user_id,approved_by_user_id,executed_by_user_id,executed_at,reason,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[org(req),req.body.documentId,req.body.actionType,req.body.scheduledAt,req.body.requestedByUserId,req.body.approvedByUserId||null,req.body.executedByUserId||null,req.body.executedAt||null,req.body.reason,req.body.evidence||[],req.body.status||'pending',req.get('Idempotency-Key')||req.body.idempotencyKey])).rows[0],201));

router.get('/access-reviews', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM document_access_reviews WHERE organisation_id=$1 ORDER BY reviewed_at DESC',[org(req)])).rows));
router.post('/access-reviews', (req,res,next) => handle(res,next,async () => (await db.pool.query(`INSERT INTO document_access_reviews (organisation_id,document_id,reviewed_by_user_id,reviewed_at,authorized_roles,findings,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[org(req),req.body.documentId,req.body.reviewedByUserId,req.body.reviewedAt,req.body.authorizedRoles||[],req.body.findings||[],req.body.evidence||[],req.get('Idempotency-Key')||req.body.idempotencyKey])).rows[0],201));

router.get('/alerts', (req,res,next) => handle(res,next,async () => (await db.pool.query(`SELECT 'retention_due' AS alert_type,id,document_id,scheduled_at AS due_at FROM document_retention_actions WHERE organisation_id=$1 AND status='pending' AND scheduled_at<=NOW()+INTERVAL '60 days' UNION ALL SELECT 'legal_hold' AS alert_type,id,id AS document_id,updated_at AS due_at FROM governed_documents WHERE organisation_id=$1 AND legal_hold=TRUE ORDER BY due_at`,[org(req)])).rows));

module.exports = router;
