const express = require('express');
const db = require('../../../db');
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
const { resourceResponse } = require('../../utils/integrationResponseContract');
const {
  parseIntegrationListQuery,
  addCommonPaginationClauses,
  finalizePage,
} = require('../../utils/integrationPagination');
const { capabilitiesMeta } = require('../../utils/serverCapabilities');

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get('Idempotency-Key') || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

router.use(requireOrganisation);

function notFound(code) {
  const error = new Error(code);
  error.statusCode = 404;
  return error;
}

router.get('/', (req, res, next) => handle(res, next, async () => {
  const page = parseIntegrationListQuery(req.query);
  const clauses = ['l.organisation_id=$1'];
  const values = [org(req)];

  if (req.query.targetType) {
    values.push(req.query.targetType);
    clauses.push(`l.target_type=$${values.length}`);
  }
  if (req.query.relationshipType) {
    values.push(req.query.relationshipType);
    clauses.push(`l.relationship_type=$${values.length}`);
  }
  if (req.query.riskId) {
    values.push(req.query.riskId);
    clauses.push(`l.risk_id=$${values.length}`);
  }
  if (req.query.targetId) {
    values.push(req.query.targetId);
    clauses.push(`l.target_id=$${values.length}`);
  }

  addCommonPaginationClauses({ clauses, values, page, alias: 'l' });
  values.push(page.limit + 1);

  const rows = (await db.query(`
    SELECT l.*
    FROM institutional_risk_links l
    WHERE ${clauses.join(' AND ')}
    ORDER BY l.created_at ${page.direction.toUpperCase()}, l.id ${page.direction.toUpperCase()}
    LIMIT $${values.length}
  `, values)).rows;

  return finalizePage(rows, page, {
    contract: 'integration-list@1',
    ...capabilitiesMeta({ user: req.user }),
  });
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
  return resourceResponse(transaction.result, {
    contract: 'integration-resource@1',
    ...capabilitiesMeta({ user: req.user, resource: transaction.result }),
  });
}, 201));

module.exports = router;
