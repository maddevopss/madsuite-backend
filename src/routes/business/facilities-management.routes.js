const express = require('express');
const db = require('../../../db');
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction } = require('../../services/business/transaction-engine.service');
require('../../services/business/facilities-management-transaction.service');

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

router.get('/sites', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM facilities_sites WHERE organisation_id=$1 ORDER BY site_code', [org(req)])).rows));
router.post('/sites', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'facilities.site.create', 'facilities.site.create', req.body, async ({ client, organisationId }) => (await client.query(`INSERT INTO facilities_sites (organisation_id,site_code,name,site_type,address,responsible_user_id,operating_status,commissioned_at,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [organisationId, req.body.siteCode, req.body.name, req.body.siteType, req.body.address || {}, req.body.responsibleUserId, req.body.operatingStatus || 'active', req.body.commissionedAt || null, req.body.evidence || []])).rows[0]), 201));

router.get('/spaces', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM facilities_spaces WHERE organisation_id=$1 ORDER BY space_code', [org(req)])).rows));
router.post('/spaces', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'facilities.space.create', 'facilities.space.create', req.body, async ({ client, organisationId }) => (await client.query(`INSERT INTO facilities_spaces (organisation_id,site_id,parent_space_id,space_code,name,space_type,responsible_user_id,capacity,capacity_unit,operating_status,commissioned_at,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [organisationId, req.body.siteId, req.body.parentSpaceId || null, req.body.spaceCode, req.body.name, req.body.spaceType, req.body.responsibleUserId, req.body.capacity || null, req.body.capacityUnit || null, req.body.operatingStatus || 'active', req.body.commissionedAt || null, req.body.evidence || []])).rows[0]), 201));

router.get('/assets', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM facilities_assets WHERE organisation_id=$1 ORDER BY asset_code', [org(req)])).rows));
router.post('/assets', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'facilities.asset.create', null, req.body, async ({ client, organisationId }) => (await client.query(`INSERT INTO facilities_assets (organisation_id,site_id,space_id,asset_code,name,asset_type,responsible_user_id,acquisition_cost,currency_code,acquired_at,commissioned_at,status,criticality,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [organisationId, req.body.siteId || null, req.body.spaceId || null, req.body.assetCode, req.body.name, req.body.assetType, req.body.responsibleUserId, req.body.acquisitionCost || null, req.body.currencyCode || 'CAD', req.body.acquiredAt || null, req.body.commissionedAt || null, req.body.status || 'active', req.body.criticality || 'normal', req.body.evidence || []])).rows[0]), 201));
router.post('/assets/:id/decommission', (req, res, next) => handle(res, next, () => {
  const input = { ...req.body, assetId: req.params.id, approvedByUserId: req.body.approvedByUserId || actor(req) };
  return transactionalWrite(req, 'facilities.asset.decommission', 'facilities.asset.decommission', input, async ({ client, organisationId }) => {
    const asset = (await client.query('SELECT id,status FROM facilities_assets WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [req.params.id, organisationId])).rows[0];
    if (!asset) { const error = new Error('facilities.asset_not_found'); error.statusCode = 404; throw error; }
    return (await client.query(`UPDATE facilities_assets SET status='decommissioned',evidence=evidence || $1::jsonb,updated_at=NOW() WHERE id=$2 AND organisation_id=$3 RETURNING *`, [JSON.stringify(input.evidence || []), req.params.id, organisationId])).rows[0];
  });
}));

router.get('/maintenance-links', (req, res, next) => handle(res, next, async () => (await db.query(`SELECT l.*,f.asset_code AS facilities_asset_code,m.asset_code AS maintenance_asset_code FROM facilities_maintenance_links l JOIN facilities_assets f ON f.id=l.facilities_asset_id AND f.organisation_id=l.organisation_id JOIN asset_records m ON m.id=l.maintenance_asset_id AND m.organisation_id=l.organisation_id WHERE l.organisation_id=$1 ORDER BY l.created_at DESC`, [org(req)])).rows));
router.post('/maintenance-links', (req, res, next) => handle(res, next, () => transactionalWrite(req, 'facilities.maintenance_link.create', null, req.body, async ({ client, organisationId, idempotencyKey }) => {
  const facilityAsset = (await client.query('SELECT id,asset_code FROM facilities_assets WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [req.body.facilitiesAssetId, organisationId])).rows[0];
  const maintenanceAsset = (await client.query('SELECT id,asset_code FROM asset_records WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [req.body.maintenanceAssetId, organisationId])).rows[0];
  if (!facilityAsset || !maintenanceAsset) { const error = new Error('facilities.maintenance_link_target_not_found'); error.statusCode = 404; throw error; }
  if (!req.body.justification || !String(req.body.justification).trim()) { const error = new Error('facilities.maintenance_link_justification_required'); error.statusCode = 400; throw error; }
  return (await client.query(`INSERT INTO facilities_maintenance_links (organisation_id,facilities_asset_id,maintenance_asset_id,relationship_type,justification,evidence,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [organisationId, req.body.facilitiesAssetId, req.body.maintenanceAssetId, req.body.relationshipType || 'same_asset', req.body.justification, req.body.evidence || [], idempotencyKey, actor(req)])).rows[0];
}), 201));

router.get('/inspections', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM facilities_inspections WHERE organisation_id=$1 ORDER BY inspected_at DESC', [org(req)])).rows));
router.post('/inspections', (req, res, next) => handle(res, next, () => {
  const completed = (req.body.status || 'completed') === 'completed';
  return transactionalWrite(req, 'facilities.inspection.create', completed ? 'facilities.inspection.complete' : null, req.body, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO facilities_inspections (organisation_id,subject_type,subject_id,inspection_number,inspected_at,inspector_user_id,findings,deficiencies,corrective_actions,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [organisationId, req.body.subjectType, req.body.subjectId, req.body.inspectionNumber, req.body.inspectedAt, req.body.inspectorUserId, req.body.findings || [], req.body.deficiencies || [], req.body.correctiveActions || [], req.body.evidence || [], req.body.status || 'completed', idempotencyKey])).rows[0]);
}, 201));

router.get('/transfers', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM facilities_transfers WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/transfers', (req, res, next) => handle(res, next, () => {
  const accepted = Boolean(req.body.acceptedByUserId) || ['accepted', 'completed'].includes(req.body.status);
  return transactionalWrite(req, 'facilities.transfer.create', accepted ? 'facilities.transfer.accept' : null, req.body, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO facilities_transfers (organisation_id,subject_type,subject_id,from_site_id,from_space_id,to_site_id,to_space_id,requested_by_user_id,accepted_by_user_id,reason,transferred_at,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [organisationId, req.body.subjectType, req.body.subjectId, req.body.fromSiteId || null, req.body.fromSpaceId || null, req.body.toSiteId || null, req.body.toSpaceId || null, req.body.requestedByUserId, req.body.acceptedByUserId || null, req.body.reason, req.body.transferredAt || null, req.body.evidence || [], req.body.status || 'pending', idempotencyKey])).rows[0]);
}, 201));

router.get('/disposals', (req, res, next) => handle(res, next, async () => (await db.query('SELECT * FROM facilities_disposals WHERE organisation_id=$1 ORDER BY created_at DESC', [org(req)])).rows));
router.post('/disposals', (req, res, next) => handle(res, next, () => {
  const approved = Boolean(req.body.approvedByUserId) || ['approved', 'disposed', 'completed'].includes(req.body.status);
  return transactionalWrite(req, 'facilities.disposal.create', approved ? 'facilities.asset.dispose' : null, req.body, async ({ client, organisationId, idempotencyKey }) => (await client.query(`INSERT INTO facilities_disposals (organisation_id,asset_id,disposal_method,reason,residual_value,currency_code,requested_by_user_id,approved_by_user_id,disposed_at,evidence,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [organisationId, req.body.assetId, req.body.disposalMethod, req.body.reason, req.body.residualValue || null, req.body.currencyCode || 'CAD', req.body.requestedByUserId, req.body.approvedByUserId || null, req.body.disposedAt || null, req.body.evidence || [], req.body.status || 'pending', idempotencyKey])).rows[0]);
}, 201));

router.get('/alerts', (req, res, next) => handle(res, next, async () => (await db.query(`SELECT 'unresolved_transfer' AS alert_type,id,subject_type,subject_id,created_at FROM facilities_transfers WHERE organisation_id=$1 AND status='pending' UNION ALL SELECT 'pending_disposal',id,'asset',asset_id,created_at FROM facilities_disposals WHERE organisation_id=$1 AND status='pending' ORDER BY created_at DESC`, [org(req)])).rows));

module.exports = router;
