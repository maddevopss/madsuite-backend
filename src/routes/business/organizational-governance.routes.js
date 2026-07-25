const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
require('../../services/business/organizational-governance-transaction.service');

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

async function transactionalWrite(req, type, policy, input, execute) {
  const transaction = await executeTransaction({ type, organisationId: org(req), actorUserId: actor(req), idempotencyKey: key(req), policies: policy ? [`${policy}@1`] : [], input, execute });
  return transaction.result;
}

router.get('/units', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governance_units WHERE organisation_id=$1 ORDER BY unit_code',[org(req)])).rows));
router.post('/units', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, leaderUserId: req.body.leaderUserId || actor(req) };
  return transactionalWrite(req, 'governance.unit.create', 'governance.unit.create', input, async ({ client, organisationId }) => (await client.query(`INSERT INTO governance_units (organisation_id,parent_unit_id,unit_code,name,unit_type,leader_user_id,mandate,status,effective_from,effective_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,input.parentUnitId||null,input.unitCode,input.name,input.unitType,input.leaderUserId,input.mandate,input.status||'active',input.effectiveFrom,input.effectiveTo||null])).rows[0]);
},201));

router.get('/delegations', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governance_delegations WHERE organisation_id=$1 ORDER BY starts_at DESC',[org(req)])).rows));
router.post('/delegations', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, delegatorUserId: req.body.delegatorUserId || actor(req) };
  return transactionalWrite(req, 'governance.delegation.create', 'governance.delegation.create', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO governance_delegations (organisation_id,delegation_number,delegator_user_id,delegate_user_id,authority_type,scope,financial_limit,starts_at,ends_at,reason,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[organisationId,input.delegationNumber,input.delegatorUserId,input.delegateUserId,input.authorityType,input.scope||[],input.financialLimit||null,input.startsAt,input.endsAt,input.reason,input.evidence||[],input.status||'active',idempotencyKey])).rows[0]);
},201));

router.get('/committees', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governance_committees WHERE organisation_id=$1 ORDER BY name',[org(req)])).rows));
router.post('/committees', (req,res,next) => handle(res,next,() => transactionalWrite(req, 'governance.committee.create', null, req.body, async ({ client, organisationId }) => (await client.query(`INSERT INTO governance_committees (organisation_id,committee_code,name,mandate,chair_user_id,secretary_user_id,quorum_required,members,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[organisationId,req.body.committeeCode,req.body.name,req.body.mandate,req.body.chairUserId,req.body.secretaryUserId||null,req.body.quorumRequired,req.body.members||[],req.body.status||'active'])).rows[0]),201));

router.get('/meetings', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governance_meetings WHERE organisation_id=$1 ORDER BY scheduled_at DESC',[org(req)])).rows));
router.post('/meetings', (req,res,next) => handle(res,next,() => transactionalWrite(req, 'governance.committee.meeting.create', null, req.body, async ({ client, organisationId, idempotencyKey }) => {
  if (req.body.status === 'completed' && (!req.body.quorumMet || !req.body.minutes || !Array.isArray(req.body.attendees) || req.body.attendees.length === 0 || !Array.isArray(req.body.agenda) || req.body.agenda.length === 0 || !Array.isArray(req.body.evidence) || req.body.evidence.length === 0)) {
    const error = new Error('governance.meeting_record_required'); error.statusCode = 409; throw error;
  }
  return (await client.query(`INSERT INTO governance_meetings (organisation_id,committee_id,meeting_number,scheduled_at,attendees,agenda,minutes,decisions,evidence,quorum_met,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[organisationId,req.body.committeeId,req.body.meetingNumber,req.body.scheduledAt,req.body.attendees||[],req.body.agenda||[],req.body.minutes||null,req.body.decisions||[],req.body.evidence||[],Boolean(req.body.quorumMet),req.body.status||'scheduled',idempotencyKey])).rows[0];
}),201));

router.get('/decisions', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governance_decisions WHERE organisation_id=$1 ORDER BY created_at DESC',[org(req)])).rows));
router.post('/decisions', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, authorUserId: req.body.authorUserId || actor(req) };
  return transactionalWrite(req, 'governance.decision.create', 'governance.decision.create', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO governance_decisions (organisation_id,meeting_id,decision_number,category,title,context,analysis,decision_text,justification,impacts,risks,evidence,author_user_id,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[organisationId,input.meetingId||null,input.decisionNumber,input.category,input.title,input.context,input.analysis,input.decisionText,input.justification,input.impacts||[],input.risks||[],input.evidence||[],input.authorUserId,input.status||'draft',idempotencyKey])).rows[0]);
},201));
router.post('/decisions/:id/approve', (req,res,next) => handle(res,next,() => transactionalWrite(req, 'governance.decision.approve', null, { ...req.body, decisionId: req.params.id }, async ({ client, organisationId }) => {
  const decision = (await client.query('SELECT author_user_id FROM governance_decisions WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[req.params.id,organisationId])).rows[0];
  if (!decision) return null;
  const approverUserId = req.body.approverUserId || actor(req);
  if (String(decision.author_user_id) === String(approverUserId)) { const error = new Error('governance.decision_independent_approval_required'); error.statusCode = 409; throw error; }
  return (await client.query(`UPDATE governance_decisions SET approver_user_id=$1,effective_at=$2,status='approved',updated_at=NOW() WHERE id=$3 AND organisation_id=$4 RETURNING *`,[approverUserId,req.body.effectiveAt||new Date().toISOString(),req.params.id,organisationId])).rows[0];
})));

router.get('/policies', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governance_policies WHERE organisation_id=$1 ORDER BY policy_number,version DESC',[org(req)])).rows));
router.post('/policies', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'governance.policy.create', null, input, async ({ client, organisationId, idempotencyKey }) => {
    if (input.status === 'published' && (!input.approvedByUserId || String(input.ownerUserId) === String(input.approvedByUserId) || !Array.isArray(input.approvalEvidence) || input.approvalEvidence.length === 0 || !input.effectiveFrom || !input.reviewDueAt)) { const error = new Error('governance.policy_approval_evidence_required'); error.statusCode = 409; throw error; }
    return (await client.query(`INSERT INTO governance_policies (organisation_id,policy_number,title,version,owner_user_id,content_reference,approval_evidence,effective_from,review_due_at,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[organisationId,input.policyNumber,input.title,input.version,input.ownerUserId,input.contentReference,input.approvalEvidence||[],input.effectiveFrom||null,input.reviewDueAt||null,input.status||'draft',idempotencyKey])).rows[0];
  });
},201));

router.get('/conflicts', (req,res,next) => handle(res,next,async () => (await db.pool.query('SELECT * FROM governance_conflicts WHERE organisation_id=$1 ORDER BY created_at DESC',[org(req)])).rows));
router.post('/conflicts', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, declarantUserId: req.body.declarantUserId || actor(req) };
  return transactionalWrite(req, 'governance.conflict.declare', 'governance.conflict.declare', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO governance_conflicts (organisation_id,declarant_user_id,conflict_number,subject_type,subject_id,description,mitigation,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,input.declarantUserId,input.conflictNumber,input.subjectType,input.subjectId||null,input.description,input.mitigation,input.evidence||[],input.status||'declared',idempotencyKey])).rows[0]);
},201));

router.get('/alerts', (req,res,next) => handle(res,next,async () => (await db.pool.query(`SELECT 'delegation_expiring' AS alert_type,id,delegation_number AS reference,ends_at AS due_at FROM governance_delegations WHERE organisation_id=$1 AND status='active' AND ends_at<=NOW()+INTERVAL '30 days' UNION ALL SELECT 'policy_review_due',id,policy_number,review_due_at::timestamptz FROM governance_policies WHERE organisation_id=$1 AND status='published' AND review_due_at<=CURRENT_DATE+30 ORDER BY due_at`,[org(req)])).rows));

module.exports = router;
