const express = require('express');
const db = require('../../../db');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
const { listResponse, resourceResponse } = require('../../utils/integrationResponseContract');

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

function notFound(code) {
  const error = new Error(code);
  error.statusCode = 404;
  return error;
}

router.get('/', (req, res, next) => handle(res, next, async () => {
  const rows = (await db.pool.query(
    'SELECT * FROM institutional_risk_links WHERE organisation_id=$1 ORDER BY created_at DESC',
    [org(req)],
  )).rows;
  return listResponse(rows, { contract: 'integration-list@1' });
}));

router.post('/', (req, res, next) => handle(res, next, async () => {
  const input = { ...req.body };
  const transaction = await executeTransaction({
    type: 'integration.risk_link.create',
    organisationId: org(req),
    actorUserId: actor(req),
    idempotencyKey: key(req),
    input,
    execute: async ({ client, organisationId, idempotencyKey }) => {
      const risk = (await client.query(
        'SELECT id FROM enterprise_risks WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
        [input.riskId, organisationId],
      )).rows[0];
      if (!risk) throw notFound('integration.risk_not_found');

      const targetTables = {
        cybersecurity_vulnerability: 'cybersecurity_vulnerabilities',
        cybersecurity_incident: 'cybersecurity_incidents',
        privacy_incident: 'privacy_incidents',
      };
      const table = targetTables[input.targetType];
      if (!table) {
        const error = new Error('integration.target_type_invalid');
        error.statusCode = 400;
        throw error;
      }

      const target = (await client.query(
        `SELECT id FROM ${table} WHERE id=$1 AND organisation_id=$2 FOR UPDATE`,
        [input.targetId, organisationId],
      )).rows[0];
      if (!target) throw notFound('integration.target_not_found');

      return (await client.query(
        `INSERT INTO institutional_risk_links
          (organisation_id,risk_id,target_type,target_id,relationship_type,rationale,evidence,created_by,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [organisationId,input.riskId,input.targetType,input.targetId,input.relationshipType,input.rationale,input.evidence||[],actor(req),idempotencyKey],
      )).rows[0];
    },
  });
  return resourceResponse(transaction.result, { contract: 'integration-resource@1' });
}, 201));

module.exports = router;
