const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
require('../../services/business/external-partner-management-transaction.service');

const router = express.Router();
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

router.get('/partners', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM external_partners WHERE organisation_id=$1 ORDER BY legal_name', [org(req)])).rows));
router.post('/partners', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'partners.partner.register', 'partners.partner.register', req.body, async ({ client, organisationId }) => (await client.query(`INSERT INTO external_partners (organisation_id,partner_code,legal_name,partner_type,registration_number,primary_contact,address,relationship_owner_user_id,risk_level,status,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [organisationId, req.body.partnerCode, req.body.legalName, req.body.partnerType, req.body.registrationNumber || null, req.body.primaryContact || {}, req.body.address || {}, req.body.relationshipOwnerUserId, req.body.riskLevel || 'normal', req.body.status || 'active', req.body.evidence || []])).rows[0]), 201));

router.get('/agreements', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM external_partner_agreements WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/agreements', (req, res, next) => handle(res, next, () => {
  const approved = Boolean(req.body.approvedByUserId) || ['approved', 'active'].includes(req.body.status);
  return transactionalWrite(req, 'partners.agreement.create', approved ? 'partners.agreement.approve' : null, req.body, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO external_partner_agreements (organisation_id,partner_id,agreement_number,agreement_type,title,effective_from,effective_to,responsibilities,obligations,service_levels,owner_user_id,approved_by_user_id,status,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [organisationId, req.body.partnerId, req.body.agreementNumber, req.body.agreementType, req.body.title, req.body.effectiveFrom, req.body.effectiveTo || null, req.body.responsibilities || [], req.body.obligations || [], req.body.serviceLevels || {}, req.body.ownerUserId, req.body.approvedByUserId || null, req.body.status || 'draft', req.body.evidence || [], idempotencyKey])).rows[0]);
}, 201));

router.get('/certifications', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM external_partner_certifications WHERE organisation_id=$1 ORDER BY expires_at NULLS LAST', [org(req)])).rows));
router.post('/certifications', (req, res, next) => handle(res, next, () => {
  const verified = (req.body.verificationStatus || 'pending') === 'verified';
  return transactionalWrite(req, 'partners.certification.create', verified ? 'partners.certification.verify' : null, req.body, async ({ client, organisationId }) => (await client.query(`INSERT INTO external_partner_certifications (organisation_id,partner_id,certification_type,certification_number,issued_by,issued_at,expires_at,verification_status,verified_by_user_id,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [organisationId, req.body.partnerId, req.body.certificationType, req.body.certificationNumber || null, req.body.issuedBy, req.body.issuedAt || null, req.body.expiresAt || null, req.body.verificationStatus || 'pending', req.body.verifiedByUserId || null, req.body.evidence || []])).rows[0]);
}, 201));

router.get('/assessments', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM external_partner_assessments WHERE organisation_id=$1 ORDER BY assessed_at DESC', [org(req)])).rows));
router.post('/assessments', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'partners.assessment.complete', 'partners.assessment.complete', req.body, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO external_partner_assessments (organisation_id,partner_id,assessment_type,assessed_at,assessed_by_user_id,criteria,score,risk_level,findings,recommendations,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [organisationId, req.body.partnerId, req.body.assessmentType, req.body.assessedAt, req.body.assessedByUserId, req.body.criteria || [], req.body.score || null, req.body.riskLevel, req.body.findings || [], req.body.recommendations || [], req.body.evidence || [], idempotencyKey])).rows[0]), 201));

router.get('/incidents', (req, res, next) => handle(res, next, async () => (await db.pool.query('SELECT * FROM external_partner_incidents WHERE organisation_id=$1 ORDER BY occurred_at DESC', [org(req)])).rows));
router.post('/incidents', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'partners.incident.report', 'partners.incident.report', req.body, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO external_partner_incidents (organisation_id,partner_id,occurred_at,incident_type,severity,description,responsible_user_id,corrective_actions,status,evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [organisationId, req.body.partnerId, req.body.occurredAt, req.body.incidentType, req.body.severity, req.body.description, req.body.responsibleUserId, req.body.correctiveActions || [], req.body.status || 'open', req.body.evidence || [], idempotencyKey])).rows[0]), 201));

router.get('/alerts', (req, res, next) => handle(res, next, async () => (await db.pool.query(`SELECT 'agreement_expiry' AS alert_type,id,effective_to AS due_at FROM external_partner_agreements WHERE organisation_id=$1 AND status='active' AND effective_to IS NOT NULL AND effective_to <= CURRENT_DATE + INTERVAL '60 days' UNION ALL SELECT 'certification_expiry',id,expires_at FROM external_partner_certifications WHERE organisation_id=$1 AND expires_at IS NOT NULL AND expires_at <= CURRENT_DATE + INTERVAL '60 days' UNION ALL SELECT 'open_partner_incident',id,occurred_at::date FROM external_partner_incidents WHERE organisation_id=$1 AND status='open' ORDER BY due_at`, [org(req)])).rows));

module.exports = router;
