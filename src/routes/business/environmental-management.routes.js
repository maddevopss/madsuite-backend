const express = require("express");
const db = require("../../../db");
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction } = require("../../services/business/transaction-engine.service");
require("../../services/business/environmental-management-transaction.service");

const router = express.Router();
router.use(requireOrganisation);
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.user_id || null;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);
const idempotency = (req) => req.get("Idempotency-Key") || req.body.idempotencyKey;

async function transactionalWrite(req, type, policy, input, execute) {
  const transaction = await executeTransaction({
    type,
    organisationId: org(req),
    actorUserId: actor(req),
    idempotencyKey: idempotency(req),
    policies: [`${policy}@1`],
    input,
    execute,
  });
  return transaction.result;
}

router.get("/permits", (req,res,next) => handle(res,next,async () => (await db.query("SELECT * FROM environmental_permits WHERE organisation_id=$1 ORDER BY expires_at",[org(req)])).rows));
router.post("/permits", (req,res,next) => handle(res,next,() => transactionalWrite(req,"environment.permit.register","environment.permit.register",req.body,async ({ client, organisationId }) => (await client.query(`INSERT INTO environmental_permits (organisation_id,site_id,permit_type,permit_number,issuing_authority,issued_at,expires_at,status,proof_refs,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,req.body.siteId||null,req.body.permitType,req.body.permitNumber,req.body.issuingAuthority,req.body.issuedAt,req.body.expiresAt,req.body.status||"active",req.body.proofRefs||[],req.body.createdBy])).rows[0]),201));

router.get("/incidents", (req,res,next) => handle(res,next,async () => (await db.query("SELECT * FROM environmental_incidents WHERE organisation_id=$1 ORDER BY occurred_at DESC",[org(req)])).rows));
router.post("/incidents", (req,res,next) => handle(res,next,() => transactionalWrite(req,"environment.incident.report","environment.incident.report",req.body,async ({ client, organisationId }) => (await client.query(`INSERT INTO environmental_incidents (organisation_id,site_id,occurred_at,incident_type,severity,description,responsible_user_id,immediate_actions,proof_refs,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[organisationId,req.body.siteId,req.body.occurredAt,req.body.incidentType,req.body.severity,req.body.description,req.body.responsibleUserId,req.body.immediateActions||[],req.body.proofRefs||[],req.body.status||"open",req.body.createdBy])).rows[0]),201));

router.get("/inspections", (req,res,next) => handle(res,next,async () => (await db.query("SELECT * FROM environmental_inspections WHERE organisation_id=$1 ORDER BY inspected_at DESC",[org(req)])).rows));
router.post("/inspections", (req,res,next) => handle(res,next,() => transactionalWrite(req,"environment.inspection.complete","environment.inspection.complete",req.body,async ({ client, organisationId }) => (await client.query(`INSERT INTO environmental_inspections (organisation_id,site_id,inspected_at,inspector_user_id,scope,findings,non_conformities,proof_refs,status,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,req.body.siteId,req.body.inspectedAt,req.body.inspectorUserId,req.body.scope||[],req.body.findings||[],req.body.nonConformities||[],req.body.proofRefs||[],req.body.status||"completed",req.body.completedAt||new Date()])).rows[0]),201));

router.get("/corrective-actions", (req,res,next) => handle(res,next,async () => (await db.query("SELECT * FROM environmental_corrective_actions WHERE organisation_id=$1 ORDER BY due_at",[org(req)])).rows));
router.post("/corrective-actions/:id/close", (req,res,next) => handle(res,next,() => transactionalWrite(req,"environment.corrective_action.close","environment.corrective_action.close",{...req.body,actionId:req.params.id},async ({ client, organisationId }) => (await client.query("UPDATE environmental_corrective_actions SET status='closed',closure_evidence=$1,closed_by=$2,closed_at=NOW() WHERE id=$3 AND organisation_id=$4 RETURNING *",[req.body.closureEvidence,req.body.closedBy,req.params.id,organisationId])).rows[0])));

router.get("/metrics", (req,res,next) => handle(res,next,async () => (await db.query("SELECT * FROM environmental_metrics WHERE organisation_id=$1 ORDER BY period_start DESC",[org(req)])).rows));
router.post("/metrics", (req,res,next) => handle(res,next,() => transactionalWrite(req,"environment.metric.record","environment.metric.record",req.body,async ({ client, organisationId }) => (await client.query(`INSERT INTO environmental_metrics (organisation_id,site_id,metric_type,period_start,period_end,value,unit,methodology,source_refs,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organisationId,req.body.siteId||null,req.body.metricType,req.body.periodStart,req.body.periodEnd,req.body.value,req.body.unit,req.body.methodology,req.body.sourceRefs||[],req.body.recordedBy])).rows[0]),201));

router.get("/reports", (req,res,next) => handle(res,next,async () => (await db.query("SELECT * FROM environmental_reports WHERE organisation_id=$1 ORDER BY created_at DESC",[org(req)])).rows));
router.post("/reports", (req,res,next) => handle(res,next,() => transactionalWrite(req,"environment.report.publish","environment.report.publish",req.body,async ({ client, organisationId }) => (await client.query(`INSERT INTO environmental_reports (organisation_id,report_type,period_start,period_end,summary,indicators,risks,proof_refs,prepared_by,approved_by,status,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[organisationId,req.body.reportType,req.body.periodStart,req.body.periodEnd,req.body.summary,req.body.indicators||{},req.body.risks||[],req.body.proofRefs||[],req.body.preparedBy,req.body.approvedBy,req.body.status||"published",req.body.publishedAt||new Date()])).rows[0]),201));

router.get("/alerts", (req,res,next) => handle(res,next,async () => (await db.query(`SELECT 'permit_expiry' AS alert_type,id,expires_at AS due_at FROM environmental_permits WHERE organisation_id=$1 AND status='active' AND expires_at<=CURRENT_DATE+INTERVAL '60 days' UNION ALL SELECT 'corrective_action_overdue',id,due_at FROM environmental_corrective_actions WHERE organisation_id=$1 AND status<>'closed' AND due_at<NOW() ORDER BY due_at`,[org(req)])).rows));

module.exports = router;
