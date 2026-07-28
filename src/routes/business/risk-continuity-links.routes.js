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

const router = express.Router({ mergeParams: true });
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

  if (req.query.relationType) {
    values.push(req.query.relationType);
    clauses.push(`l.relation_type=$${values.length}`);
  }
  if (req.query.riskId) {
    values.push(req.query.riskId);
    clauses.push(`l.risk_id=$${values.length}`);
  }
  if (req.query.processId) {
    values.push(req.query.processId);
    clauses.push(`l.process_id=$${values.length}`);
  }
  if (req.query.planId) {
    values.push(req.query.planId);
    clauses.push(`l.plan_id=$${values.length}`);
  }

  addCommonPaginationClauses({ clauses, values, page, alias: 'l' });
  values.push(page.limit + 1);

  const rows = (await db.pool.query(`
    SELECT l.*, r.risk_number, r.title AS risk_title,
           p.process_number, p.name AS process_name,
           cp.plan_number, cp.title AS plan_title
    FROM enterprise_risk_continuity_links l
    JOIN enterprise_risks r ON r.id=l.risk_id AND r.organisation_id=l.organisation_id
    LEFT JOIN enterprise_business_processes p ON p.id=l.process_id AND p.organisation_id=l.organisation_id
    LEFT JOIN enterprise_continuity_plans cp ON cp.id=l.plan_id AND cp.organisation_id=l.organisation_id
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
  const transaction = await executeTransaction({
    type: 'integration.risk_continuity.link',
    organisationId: org(req),
    actorUserId: actor(req),
    idempotencyKey: key(req),
    input: req.body,
    execute: async ({ client, organisationId, idempotencyKey }) => {
      const risk = (await client.query('SELECT id FROM enterprise_risks WHERE id=$1 AND organisation_id=$2 FOR SHARE', [req.body.riskId, organisationId])).rows[0];
      if (!risk) throw notFound('integration.risk_not_found');

      if (req.body.processId) {
        const process = (await client.query('SELECT id FROM enterprise_business_processes WHERE id=$1 AND organisation_id=$2 FOR SHARE', [req.body.processId, organisationId])).rows[0];
        if (!process) throw notFound('integration.continuity_process_not_found');
      }

      if (req.body.planId) {
        const plan = (await client.query('SELECT id,process_id FROM enterprise_continuity_plans WHERE id=$1 AND organisation_id=$2 FOR SHARE', [req.body.planId, organisationId])).rows[0];
        if (!plan) throw notFound('integration.continuity_plan_not_found');
        if (req.body.processId && String(plan.process_id) !== String(req.body.processId)) {
          const error = new Error('integration.plan_process_mismatch');
          error.statusCode = 409;
          throw error;
        }
      }

      return (await client.query(`
        INSERT INTO enterprise_risk_continuity_links
          (organisation_id,risk_id,process_id,plan_id,relation_type,rationale,evidence,idempotency_key,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
      `, [organisationId, req.body.riskId, req.body.processId || null, req.body.planId || null, req.body.relationType, req.body.rationale, req.body.evidence || [], idempotencyKey, actor(req)])).rows[0];
    },
  });
  return resourceResponse(transaction.result, {
    contract: 'integration-resource@1',
    ...capabilitiesMeta({ user: req.user, resource: transaction.result }),
  });
}, 201));

module.exports = router;
