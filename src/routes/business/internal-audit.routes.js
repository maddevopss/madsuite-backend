const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
require('../../services/business/internal-audit-transaction.service');

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

router.get('/programs', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM internal_audit_programs WHERE organisation_id=$1 ORDER BY period_start DESC',[org(req)])).rows));
router.post('/programs', (req,res,next) => handle(res,next,() => transactionalWrite(req,'audit.program.create','audit.program.create',req.body,async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO internal_audit_programs (organisation_id,program_number,title,period_start,period_end,objectives,scope,risk_basis,owner_user_id,status,approval_evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[organisationId,req.body.programNumber,req.body.title,req.body.periodStart,req.body.periodEnd,req.body.objectives,req.body.scope||[],req.body.riskBasis||[],req.body.ownerUserId,req.body.status||'draft',req.body.approvalEvidence||[],idempotencyKey])).rows[0]),201));

router.get('/engagements', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM internal_audit_engagements WHERE organisation_id=$1 ORDER BY created_at DESC',[org(req)])).rows));
router.post('/engagements', (req,res,next) => handle(res,next,() => transactionalWrite(req,'audit.engagement.create',null,req.body,async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO internal_audit_engagements (organisation_id,program_id,engagement_number,title,audit_type,objective,scope,criteria,lead_auditor_user_id,auditee_owner_user_id,planned_start_at,planned_end_at,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[organisationId,req.body.programId||null,req.body.engagementNumber,req.body.title,req.body.auditType,req.body.objective,req.body.scope||[],req.body.criteria||[],req.body.leadAuditorUserId||actor(req),req.body.auditeeOwnerUserId,req.body.plannedStartAt||null,req.body.plannedEndAt||null,idempotencyKey])).rows[0]),201));

router.get('/findings', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM internal_audit_findings WHERE organisation_id=$1 ORDER BY created_at DESC',[org(req)])).rows));
router.post('/findings', (req,res,next) => handle(res,next,() => transactionalWrite(req,'audit.finding.create','audit.finding.create',req.body,async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO internal_audit_findings (organisation_id,engagement_id,finding_number,classification,title,description,criterion,root_cause,owner_user_id,due_at,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[organisationId,req.body.engagementId,req.body.findingNumber,req.body.classification,req.body.title,req.body.description,req.body.criterion,req.body.rootCause||null,req.body.ownerUserId,req.body.dueAt||null,req.body.evidence||[],idempotencyKey])).rows[0]),201));
router.post('/findings/:id/close', (req,res,next) => handle(res,next,() => transactionalWrite(req,'audit.finding.close',null,{...req.body,findingId:req.params.id},async ({ client, organisationId }) => (await client.query(`UPDATE internal_audit_findings SET status='closed',closure_reason=$1,evidence=$2,updated_at=NOW() WHERE id=$3 AND organisation_id=$4 RETURNING *`,[req.body.closureReason,req.body.evidence||[],req.params.id,organisationId])).rows[0])));

router.get('/actions', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM internal_audit_actions WHERE organisation_id=$1 ORDER BY created_at DESC',[org(req)])).rows));
router.post('/actions', (req,res,next) => handle(res,next,() => transactionalWrite(req,'audit.action.create',null,req.body,async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO internal_audit_actions (organisation_id,finding_id,action_number,description,owner_user_id,due_at,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[organisationId,req.body.findingId,req.body.actionNumber,req.body.description,req.body.ownerUserId,req.body.dueAt||null,idempotencyKey])).rows[0]),201));

router.get('/followups', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM internal_audit_followups WHERE organisation_id=$1 ORDER BY reviewed_at DESC',[org(req)])).rows));
router.post('/followups', (req,res,next) => handle(res,next,() => transactionalWrite(req,'audit.followup.complete','audit.followup.complete',{...req.body,reviewerUserId:req.body.reviewerUserId||actor(req)},async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO internal_audit_followups (organisation_id,engagement_id,followup_number,reviewer_user_id,conclusion,residual_risk,next_followup_at,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,req.body.engagementId,req.body.followupNumber,req.body.reviewerUserId||actor(req),req.body.conclusion,req.body.residualRisk||null,req.body.nextFollowupAt||null,req.body.evidence||[],req.body.status||'completed',idempotencyKey])).rows[0]),201));

router.get('/alerts', (req,res,next) => handle(res,next,async () => (await db.pool.query(`SELECT 'finding_due' AS alert_type,id,finding_number AS reference,due_at FROM internal_audit_findings WHERE organisation_id=$1 AND due_at<=NOW() AND status NOT IN ('closed','cancelled') UNION ALL SELECT 'action_due',id,action_number,due_at FROM internal_audit_actions WHERE organisation_id=$1 AND due_at<=NOW() AND status NOT IN ('closed','cancelled') ORDER BY due_at`,[org(req)])).rows));

module.exports = router;
