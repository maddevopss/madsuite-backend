const express = require("express");
const db = require("../../../db");
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { organisationValue } = require("../../utils/organisationScope");

const router = express.Router();
router.use(requireOrganisation);
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

router.get("/records", (req, res, next) => handle(res, next, async () => (await db.query(
  `SELECT r.*,v.version current_version,v.checksum_sha256 current_checksum
   FROM document_records r
   LEFT JOIN document_versions v ON v.id=r.current_version_id AND v.organisation_id=r.organisation_id
   WHERE r.organisation_id=$1 ORDER BY r.updated_at DESC`,
  [org(req)],
)).rows));

router.post("/records", (req, res, next) => handle(res, next, async () => (await db.query(
  `INSERT INTO document_records (organisation_id,document_number,title,document_type,classification,owner_user_id,retention_until,created_by)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
  [org(req), req.body.documentNumber, req.body.title, req.body.documentType, req.body.classification || "internal", req.body.ownerUserId || null, req.body.retentionUntil || null, actor(req)],
)).rows[0], 201));

router.get("/records/:id/versions", (req, res, next) => handle(res, next, async () => (await db.query(
  `SELECT * FROM document_versions WHERE organisation_id=$1 AND document_id=$2 ORDER BY created_at DESC`,
  [org(req), Number(req.params.id)],
)).rows));

router.post("/records/:id/versions", (req, res, next) => handle(res, next, async () => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(org(req))]);
    const inserted = await client.query(
      `INSERT INTO document_versions (organisation_id,document_id,version,file_name,mime_type,storage_key,byte_size,checksum_sha256,source,effective_from,supersedes_version_id,metadata,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [org(req), Number(req.params.id), req.body.version, req.body.fileName, req.body.mimeType, req.body.storageKey, req.body.byteSize, req.body.checksumSha256, req.body.source, req.body.effectiveFrom || null, req.body.supersedesVersionId || null, req.body.metadata || {}, actor(req)],
    );
    await client.query(`UPDATE document_records SET current_version_id=$3,updated_at=NOW() WHERE organisation_id=$1 AND id=$2`, [org(req), Number(req.params.id), inserted.rows[0].id]);
    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}, 201));

router.get("/links/:aggregateType/:aggregateId", (req, res, next) => handle(res, next, async () => (await db.query(
  `SELECT l.*,r.document_number,r.title,r.status FROM document_links l JOIN document_records r ON r.id=l.document_id AND r.organisation_id=l.organisation_id WHERE l.organisation_id=$1 AND l.aggregate_type=$2 AND l.aggregate_id=$3 ORDER BY l.created_at DESC`,
  [org(req), req.params.aggregateType, req.params.aggregateId],
)).rows));

router.post("/records/:id/links", (req, res, next) => handle(res, next, async () => (await db.query(
  `INSERT INTO document_links (organisation_id,document_id,aggregate_type,aggregate_id,relation,created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,
  [org(req), Number(req.params.id), req.body.aggregateType, String(req.body.aggregateId), req.body.relation || "evidence_for", actor(req)],
)).rows[0], 201));

router.get("/alerts", (req, res, next) => handle(res, next, async () => {
  const organisationId = org(req);
  const [retention, unversioned] = await Promise.all([
    db.query(`SELECT id,document_number,title,retention_until,legal_hold FROM document_records WHERE organisation_id=$1 AND retention_until<=CURRENT_DATE+INTERVAL '60 days' ORDER BY retention_until`, [organisationId]),
    db.query(`SELECT id,document_number,title FROM document_records WHERE organisation_id=$1 AND current_version_id IS NULL ORDER BY created_at`, [organisationId]),
  ]);
  return { retention: retention.rows, unversioned: unversioned.rows };
}));

module.exports = router;
