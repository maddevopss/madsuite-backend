const express = require('express');
const db = require('../../../db');
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');

const router = express.Router();
router.use(requireOrganisation);
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);
const validIdempotency = (value) => Boolean(value && String(value).trim().length >= 8);

function notFound(code) {
  const error = new Error(code);
  error.statusCode = 404;
  return error;
}

router.get('/', (req, res, next) => handle(res, next, async () => (await db.query(
  'SELECT * FROM audit_corrective_action_links WHERE organisation_id=$1 ORDER BY created_at DESC',
  [org(req)],
)).rows));

router.post('/', (req, res, next) => {
  if (!validIdempotency(key(req))) return res.status(400).json({ code: 'integration.idempotency_required' });
  return handle(res, next, async () => {
  const input = { ...req.body };
  const transaction = await executeTransaction({
    type: 'integration.audit_action_link.create',
    organisationId: org(req),
    actorUserId: actor(req),
    idempotencyKey: key(req),
    input,
    execute: async ({ client, organisationId, idempotencyKey }) => {
      const finding = (await client.query(
        'SELECT id FROM internal_audit_findings WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
        [input.findingId, organisationId],
      )).rows[0];
      if (!finding) throw notFound('integration.audit_finding_not_found');

      const targetTables = {
        performance_improvement_plan: 'performance_improvement_plans',
        cybersecurity_vulnerability: 'cybersecurity_vulnerabilities',
        privacy_retention_action: 'privacy_retention_actions',
      };
      const table = targetTables[input.targetType];
      if (!table) {
        const error = new Error('integration.audit_target_type_invalid');
        error.statusCode = 400;
        throw error;
      }

      const target = (await client.query(
        `SELECT id FROM ${table} WHERE id=$1 AND organisation_id=$2 FOR UPDATE`,
        [input.targetId, organisationId],
      )).rows[0];
      if (!target) throw notFound('integration.audit_target_not_found');

      // #171 PR H : une relance avec la même clé d'idempotence ne doit
      // jamais échouer sur la contrainte d'unicité métier — ON CONFLICT
      // DO NOTHING + repli par (organisation_id, idempotency_key).
      const inserted = (await client.query(
        `INSERT INTO audit_corrective_action_links
          (organisation_id,finding_id,target_type,target_id,verification_role,rationale,created_by,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (organisation_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [organisationId,input.findingId,input.targetType,input.targetId,input.verificationRole||'independent_review',input.rationale,actor(req),idempotencyKey],
      )).rows[0];
      if (inserted) return inserted;
      return (await client.query(
        'SELECT * FROM audit_corrective_action_links WHERE organisation_id=$1 AND idempotency_key=$2',
        [organisationId, idempotencyKey],
      )).rows[0];
    },
  });
  return transaction.result;
  }, 201);
});

module.exports = router;
