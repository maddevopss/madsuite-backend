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

function notFound(code) {
  const error = new Error(code);
  error.statusCode = 404;
  return error;
}

router.get('/', (req, res, next) => handle(res, next, async () => (await db.query(
  'SELECT * FROM document_evidence_references WHERE organisation_id=$1 ORDER BY created_at DESC',
  [org(req)],
)).rows));

router.post('/', (req, res, next) => handle(res, next, async () => {
  const input = { ...req.body };
  const transaction = await executeTransaction({
    type: 'integration.document_evidence_reference.create',
    organisationId: org(req),
    actorUserId: actor(req),
    idempotencyKey: key(req),
    input,
    execute: async ({ client, organisationId, idempotencyKey }) => {
      const document = (await client.query(
        'SELECT id,current_version FROM governed_documents WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
        [input.documentId, organisationId],
      )).rows[0];
      if (!document) throw notFound('integration.document_not_found');

      if (input.versionId) {
        const version = (await client.query(
          'SELECT id FROM governed_document_versions WHERE id=$1 AND document_id=$2 AND organisation_id=$3 FOR UPDATE',
          [input.versionId, input.documentId, organisationId],
        )).rows[0];
        if (!version) throw notFound('integration.document_version_not_found');
      }

      return (await client.query(
        `INSERT INTO document_evidence_references
          (organisation_id,document_id,version_id,aggregate_type,aggregate_id,evidence_role,rationale,created_by,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [organisationId,input.documentId,input.versionId||null,input.aggregateType,input.aggregateId,input.evidenceRole||'supporting_evidence',input.rationale||null,actor(req),idempotencyKey],
      )).rows[0];
    },
  });
  return transaction.result;
}, 201));

module.exports = router;
