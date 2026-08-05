const express = require('express');
const db = require('../../../db');
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction, evaluatePolicy } = require('../../services/business/transaction-engine.service');
const { resolveAuthority } = require('../../services/business/governance-authority.service');
const { checkBlockClosure } = require('../../utils/blockClosureValidation');
require('../../services/business/organizational-governance-transaction.service');

const router = express.Router();
router.use(requireOrganisation);
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);
const requireKey = (req, res) => { if (!key(req) || String(key(req)).trim().length < 8) { res.status(400).json({ code: 'governance.idempotency_required' }); return false; } return true; };

async function transactionalWrite(req, type, policy, input, execute) {
  const transaction = await executeTransaction({ type, organisationId: org(req), actorUserId: actor(req), idempotencyKey: key(req), policies: policy ? [`${policy}@1`] : [], input, execute });
  return transaction.result;
}

function notFound(code) {
  const error = new Error(code);
  error.statusCode = 404;
  return error;
}

function deny(decision) {
  const error = new Error(decision.code || decision.reason || 'governance.policy_denied');
  error.statusCode = decision.statusCode || 409;
  throw error;
}

router.get('/units', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM governance_units WHERE organisation_id=$1 ORDER BY unit_code',[org(req)])).rows));
router.post('/units', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, leaderUserId: req.body.leaderUserId || actor(req) };
  return transactionalWrite(req, 'governance.unit.create', 'governance.unit.create', input, async ({ client, organisationId }) => (await client.query(`INSERT INTO governance_units (organisation_id,parent_unit_id,unit_code,name,unit_type,leader_user_id,mandate,status,effective_from,effective_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,input.parentUnitId||null,input.unitCode,input.name,input.unitType,input.leaderUserId,input.mandate,input.status||'active',input.effectiveFrom,input.effectiveTo||null])).rows[0]);
},201));

router.get('/delegations', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM governance_delegations WHERE organisation_id=$1 ORDER BY starts_at DESC',[org(req)])).rows));
router.post('/delegations', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, delegatorUserId: req.body.delegatorUserId || actor(req) };
  return transactionalWrite(req, 'governance.delegation.create', 'governance.delegation.create', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO governance_delegations (organisation_id,delegation_number,delegator_user_id,delegate_user_id,authority_type,scope,financial_limit,starts_at,ends_at,reason,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[organisationId,input.delegationNumber,input.delegatorUserId,input.delegateUserId,input.authorityType,JSON.stringify(input.scope||[]),input.financialLimit||null,input.startsAt,input.endsAt,input.reason,JSON.stringify(input.evidence||[]),input.status||'active',idempotencyKey])).rows[0]);
},201));

router.get('/committees', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM governance_committees WHERE organisation_id=$1 ORDER BY name',[org(req)])).rows));
router.post('/committees', (req,res,next) => handle(res,next,() => transactionalWrite(req, 'governance.committee.create', null, req.body, async ({ client, organisationId }) => (await client.query(`INSERT INTO governance_committees (organisation_id,committee_code,name,mandate,chair_user_id,secretary_user_id,quorum_required,members,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[organisationId,req.body.committeeCode,req.body.name,req.body.mandate,req.body.chairUserId,req.body.secretaryUserId||null,req.body.quorumRequired,JSON.stringify(req.body.members||[]),req.body.status||'active'])).rows[0]),201));

router.get('/meetings', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM governance_meetings WHERE organisation_id=$1 ORDER BY scheduled_at DESC',[org(req)])).rows));
router.post('/meetings', (req,res,next) => {
  if (!requireKey(req, res)) return;
  return handle(res,next,() => transactionalWrite(req, 'governance.committee.meeting.create', null, req.body, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO governance_meetings (organisation_id,committee_id,meeting_number,scheduled_at,attendees,agenda,minutes,decisions,evidence,quorum_met,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[organisationId,req.body.committeeId,req.body.meetingNumber,req.body.scheduledAt,JSON.stringify(req.body.attendees||[]),JSON.stringify(req.body.agenda||[]),req.body.minutes||null,JSON.stringify(req.body.decisions||[]),JSON.stringify(req.body.evidence||[]),Boolean(req.body.quorumMet),req.body.status||'scheduled',idempotencyKey])).rows[0]),201);
});
router.post('/meetings/:id/complete', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, meetingId: req.params.id };
  return transactionalWrite(req, 'governance.committee.meeting.complete', 'governance.committee.meeting.complete', input, async ({ client, organisationId }) => {
    const meeting = (await client.query('SELECT id,status FROM governance_meetings WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[req.params.id,organisationId])).rows[0];
    if (!meeting) throw notFound('governance.meeting_not_found');
    return (await client.query(`UPDATE governance_meetings SET attendees=$1,agenda=$2,minutes=$3,decisions=$4,evidence=$5,quorum_met=$6,status='completed',updated_at=NOW() WHERE id=$7 AND organisation_id=$8 RETURNING *`,[JSON.stringify(input.attendees||[]),JSON.stringify(input.agenda||[]),input.minutes,JSON.stringify(input.decisions||[]),JSON.stringify(input.evidence||[]),Boolean(input.quorumMet),req.params.id,organisationId])).rows[0];
  });
}));

router.get('/decisions', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM governance_decisions WHERE organisation_id=$1 ORDER BY created_at DESC',[org(req)])).rows));
router.post('/decisions', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, authorUserId: req.body.authorUserId || actor(req) };
  return transactionalWrite(req, 'governance.decision.create', 'governance.decision.create', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO governance_decisions (organisation_id,meeting_id,decision_number,category,title,context,analysis,decision_text,justification,impacts,risks,evidence,author_user_id,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[organisationId,input.meetingId||null,input.decisionNumber,input.category,input.title,input.context,input.analysis,input.decisionText,input.justification,JSON.stringify(input.impacts||[]),JSON.stringify(input.risks||[]),JSON.stringify(input.evidence||[]),input.authorUserId,input.status||'draft',idempotencyKey])).rows[0]);
},201));
router.post('/decisions/:id/approve', (req,res,next) => handle(res,next,() => transactionalWrite(req, 'governance.decision.approve', null, { ...req.body, decisionId: req.params.id }, async ({ client, organisationId, idempotencyKey }) => {
  const decision = (await client.query('SELECT id,author_user_id,category,status FROM governance_decisions WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[req.params.id,organisationId])).rows[0];
  if (!decision) throw notFound('governance.decision_not_found');
  checkBlockClosure(decision, { finalStates: ['approved', 'rejected', 'archived', 'cancelled'] });
  const approverUserId = req.body.approverUserId || actor(req);
  const authority = await resolveAuthority(client,{ organisationId, actorUserId: approverUserId, authorityType: req.body.authorityType || 'decision.approve', requestedScope: req.body.requestedScope || decision.category, requestedAmount: req.body.requestedAmount ?? null, subjectType: 'decision', subjectId: req.params.id });
  const input = { ...req.body, decisionId: req.params.id, authorUserId: decision.author_user_id, approverUserId, authorityValid: authority.withinScope && authority.withinPeriod && !authority.activeConflict && (authority.requestedAmount == null || authority.financialLimit == null || Number(authority.requestedAmount) <= Number(authority.financialLimit)), activeConflict: authority.activeConflict };
  const policy = await evaluatePolicy({ policy: 'governance.decision.approve@1', input, idempotencyKey, organisationId, actorUserId: approverUserId, client });
  if (!policy.allowed) deny(policy);
  return (await client.query(`UPDATE governance_decisions SET approver_user_id=$1,effective_at=$2,status='approved',updated_at=NOW() WHERE id=$3 AND organisation_id=$4 RETURNING *`,[approverUserId,req.body.effectiveAt||new Date().toISOString(),req.params.id,organisationId])).rows[0];
})));

router.get('/policies', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM governance_policies WHERE organisation_id=$1 ORDER BY policy_number,version DESC',[org(req)])).rows));
router.post('/policies', (req,res,next) => {
  if (!requireKey(req, res)) return;
  return handle(res,next,() => {
  const input = { ...req.body, ownerUserId: req.body.ownerUserId || actor(req) };
  return transactionalWrite(req, 'governance.policy.create', null, input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO governance_policies (organisation_id,policy_number,title,version,owner_user_id,content_reference,approval_evidence,effective_from,review_due_at,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[organisationId,input.policyNumber,input.title,input.version,input.ownerUserId,input.contentReference,JSON.stringify(input.approvalEvidence||[]),input.effectiveFrom||null,input.reviewDueAt||null,input.status||'draft',idempotencyKey])).rows[0]);
  },201);
});
router.post('/policies/:id/publish', (req,res,next) => handle(res,next,() => transactionalWrite(req, 'governance.policy.publish', null, { ...req.body, policyId: req.params.id }, async ({ client, organisationId, idempotencyKey }) => {
  const current = (await client.query('SELECT id,owner_user_id,status FROM governance_policies WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[req.params.id,organisationId])).rows[0];
  if (!current) throw notFound('governance.policy_not_found');
  checkBlockClosure(current, { finalStates: ['published', 'archived', 'cancelled'] });
  const input = { ...req.body, policyId: req.params.id, ownerUserId: current.owner_user_id, approvedByUserId: req.body.approvedByUserId || actor(req) };
  const policy = await evaluatePolicy({ policy: 'governance.policy.publish@1', input, idempotencyKey, organisationId, actorUserId: actor(req), client });
  if (!policy.allowed) deny(policy);
  return (await client.query(`UPDATE governance_policies SET approved_by_user_id=$1,approval_evidence=$2,effective_from=$3,review_due_at=$4,status='published',updated_at=NOW() WHERE id=$5 AND organisation_id=$6 RETURNING *`,[input.approvedByUserId,JSON.stringify(input.approvalEvidence||[]),input.effectiveFrom,input.reviewDueAt,req.params.id,organisationId])).rows[0];
})));

router.post('/authority/validate', (req,res,next) => handle(res,next,() => transactionalWrite(req, 'governance.authority.validate', null, req.body, async ({ client, organisationId, idempotencyKey }) => {
  const authority = await resolveAuthority(client,{ organisationId, actorUserId: req.body.actorUserId || actor(req), authorityType: req.body.authorityType, requestedScope: req.body.requestedScope||null, requestedAmount: req.body.requestedAmount??null, subjectType: req.body.subjectType||null, subjectId: req.body.subjectId||null });
  const policy = await evaluatePolicy({ policy: 'governance.authority.validate@1', input: authority, idempotencyKey, organisationId, actorUserId: actor(req), client });
  if (!policy.allowed) deny(policy);
  return { valid: true, authority };
})));

router.get('/conflicts', (req,res,next) => handle(res,next,async () => (await db.query('SELECT * FROM governance_conflicts WHERE organisation_id=$1 ORDER BY created_at DESC',[org(req)])).rows));
router.post('/conflicts', (req,res,next) => handle(res,next,() => {
  const input = { ...req.body, declarantUserId: req.body.declarantUserId || actor(req) };
  return transactionalWrite(req, 'governance.conflict.declare', 'governance.conflict.declare', input, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO governance_conflicts (organisation_id,declarant_user_id,conflict_number,subject_type,subject_id,description,mitigation,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,input.declarantUserId,input.conflictNumber,input.subjectType,input.subjectId||null,input.description,input.mitigation,JSON.stringify(input.evidence||[]),input.status||'declared',idempotencyKey])).rows[0]);
},201));

router.get('/alerts', (req,res,next) => handle(res,next,async () => (await db.query(`SELECT 'delegation_expiring' AS alert_type,id,delegation_number AS reference,ends_at AS due_at FROM governance_delegations WHERE organisation_id=$1 AND status='active' AND ends_at<=NOW()+INTERVAL '30 days' UNION ALL SELECT 'policy_review_due',id,policy_number,review_due_at::timestamptz FROM governance_policies WHERE organisation_id=$1 AND status='published' AND review_due_at<=CURRENT_DATE+30 ORDER BY due_at`,[org(req)])).rows));

module.exports = router;
