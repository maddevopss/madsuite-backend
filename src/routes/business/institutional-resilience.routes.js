const express = require('express');
const db = require('../../../db');
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
require('../../services/business/institutional-resilience-transaction.service');

const router = express.Router();
router.use(requireOrganisation);
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.user_id || null;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);
const idempotency = (req) => req.get('Idempotency-Key') || req.body.idempotencyKey;

async function transactionalWrite(req, type, policy, input, execute) {
  const transaction = await executeTransaction({
    type,
    organisationId: org(req),
    actorUserId: actor(req),
    idempotencyKey: idempotency(req),
    policies: policy ? [`${policy}@1`] : [],
    input,
    execute,
  });
  return transaction.result;
}

router.get('/events', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM resilience_events WHERE organisation_id=$1 ORDER BY opened_at DESC', [org(req)])).rows));
router.post('/events', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'resilience.event.open', 'resilience.event.open', { event: req.body }, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO resilience_events (organisation_id,event_type,title,severity,status,owner_user_id,justification,opened_at,proof_reference,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [organisationId, req.body.eventType, req.body.title, req.body.severity || 'medium', req.body.status || 'open', req.body.ownerUserId, req.body.justification, req.body.openedAt || new Date(), req.body.proofReference, idempotencyKey])).rows[0]), 201));

router.get('/crisis-cells', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM resilience_crisis_cells WHERE organisation_id=$1 ORDER BY activated_at DESC', [org(req)])).rows));
router.post('/crisis-cells', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'resilience.crisis.activate', 'resilience.crisis.activate', { crisisCell: req.body }, async ({ client, organisationId }) => (await client.query(`INSERT INTO resilience_crisis_cells (organisation_id,event_id,lead_user_id,mandate,proof_reference) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [organisationId, req.body.eventId, req.body.leadUserId, req.body.mandate, req.body.proofReference])).rows[0]), 201));

router.get('/decisions', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM resilience_decisions WHERE organisation_id=$1 ORDER BY decided_at DESC', [org(req)])).rows));
router.post('/decisions', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'resilience.decision.record', 'resilience.decision.record', { decision: req.body }, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO resilience_decisions (organisation_id,event_id,author_user_id,decision,justification,decided_at,proof_reference,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [organisationId, req.body.eventId, req.body.authorUserId, req.body.decision, req.body.justification, req.body.decidedAt || new Date(), req.body.proofReference, idempotencyKey])).rows[0]), 201));

router.get('/communications', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM resilience_communications WHERE organisation_id=$1 ORDER BY published_at DESC', [org(req)])).rows));
router.post('/communications', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'resilience.communication.publish', 'resilience.communication.publish', { communication: req.body }, async ({ client, organisationId }) => (await client.query(`INSERT INTO resilience_communications (organisation_id,event_id,author_user_id,approver_user_id,channel,audience,message,published_at,proof_reference,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`, [organisationId, req.body.eventId, req.body.authorUserId, req.body.approverUserId, req.body.channel, req.body.audience, req.body.message, req.body.publishedAt || new Date(), req.body.proofReference])).rows[0]), 201));

router.get('/timeline', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM resilience_timeline WHERE organisation_id=$1 ORDER BY occurred_at DESC', [org(req)])).rows));
router.post('/timeline', (req, res, next) => handle(res, next, async () => (await db.query(`INSERT INTO resilience_timeline (organisation_id,event_id,entry_type,details,occurred_at,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [org(req), req.body.eventId, req.body.entryType, JSON.stringify(req.body.details || {}), req.body.occurredAt || new Date(), actor(req)])).rows[0], 201));

router.get('/exercises', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM resilience_exercises WHERE organisation_id=$1 ORDER BY performed_at DESC', [org(req)])).rows));
router.post('/exercises', (req, res, next) => handle(res, next, () => {
  const completed = (req.body.status || 'planned') === 'completed';
  return transactionalWrite(req, 'resilience.exercise.create', completed ? 'resilience.exercise.complete' : null, { exercise: req.body }, async ({ client, organisationId }) => (await client.query(`INSERT INTO resilience_exercises (organisation_id,title,scenario,coordinator_user_id,performed_at,report_reference,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [organisationId, req.body.title, req.body.scenario, req.body.coordinatorUserId, req.body.performedAt, req.body.reportReference || null, req.body.status || 'planned'])).rows[0]);
}, 201));

router.get('/lessons', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM resilience_lessons WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/lessons', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'resilience.lesson.record', 'resilience.lesson.record', { lesson: req.body }, async ({ client, organisationId }) => (await client.query(`INSERT INTO resilience_lessons (organisation_id,source_type,source_id,lesson,impact,owner_user_id,proof_reference) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [organisationId, req.body.sourceType, req.body.sourceId, req.body.lesson, req.body.impact, req.body.ownerUserId, req.body.proofReference])).rows[0]), 201));

router.get('/improvements', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM resilience_improvements WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/improvements', (req, res, next) => {
  if (!req.body.ownerUserId) return res.status(400).json({ code: 'RESILIENCE_IMPROVEMENT_OWNER_REQUIRED' });
  return handle(res, next, async () => (await db.query(`INSERT INTO resilience_improvements (organisation_id,lesson_id,title,owner_user_id,due_at,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [org(req), req.body.lessonId || null, req.body.title, req.body.ownerUserId, req.body.dueAt || null, req.body.status || 'open'])).rows[0], 201);
});
router.post('/improvements/:id/close', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'resilience.improvement.close', 'resilience.improvement.close', { improvement: req.body }, async ({ client, organisationId }) => (await client.query(`UPDATE resilience_improvements SET status='closed',closure_proof_reference=$1,closed_at=NOW() WHERE id=$2 AND organisation_id=$3 RETURNING *`, [req.body.closureProofReference, req.params.id, organisationId])).rows[0])));

router.get('/alerts', (req, res, next) => handle(res, next, async () => (await db.query(`SELECT 'open_major_event' AS alert_type,id,opened_at AS due_at FROM resilience_events WHERE organisation_id=$1 AND status='open' AND severity IN ('high','critical') UNION ALL SELECT 'overdue_improvement',id,due_at FROM resilience_improvements WHERE organisation_id=$1 AND status='open' AND due_at < NOW() ORDER BY due_at`, [org(req)])).rows));

module.exports = router;
