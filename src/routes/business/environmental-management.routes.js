const express = require("express");
const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { evaluatePolicy } = require("../../services/business/transaction-engine.service");
require("../../services/business/environmental-management-transaction.service");

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);
const evaluate = (req, policy, input = req.body) => evaluatePolicy({ policy, input, idempotencyKey: req.get("Idempotency-Key") || req.body.idempotencyKey });

router.get("/permits", (req,res,next) => handle(res,next,async () => (await db.pool.query("SELECT * FROM environmental_permits WHERE organisation_id=$1 ORDER BY expires_at",[org(req)])).rows));
router.post("/permits", (req,res,next) => handle(res,next,async () => {
  await evaluate(req,"environment.permit.register@1");
  return (await db.pool.query(`INSERT INTO environmental_permits (organisation_id,site_id,permit_type,permit_number,issuing_authority,issued_at,expires_at,status,proof_refs,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[org(req),req.body.siteId||null,req.body.permitType,req.body.permitNumber,req.body.issuingAuthority,req.body.issuedAt,req.body.expiresAt,req.body.status||"active",req.body.proofRefs||[],req.body.createdBy])).rows[0];
},201));

router.get("/incidents", (req,res,next) => handle(res,next,async () => (await db.pool.query("SELECT * FROM environmental_incidents WHERE organisation_id=$1 ORDER BY occurred_at DESC",[org(req)])).rows));
router.post("/incidents", (req,res,next) => handle(res,next,async () => {
  await evaluate(req,"environment.incident.report@1");
  return (await db.pool.query(`INSERT INTO environmental_incidents (organisation_id,site_id,occurred_at,incident_type,severity,description,responsible_user_id,immediate_actions,proof_refs,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[org(req),req.body.siteId,req.body.occurredAt,req.body.incidentType,req.body.severity,req.body.description,req.body.responsibleUserId,req.body.immediateActions||[],req.body.proofRefs||[],req.body.status||"open",req.body.createdBy])).rows[0];
},201));

router.get("/inspections", (req,res,next) => handle(res,next,async () => (await db.pool.query("SELECT * FROM environmental_inspections WHERE organisation_id=$1 ORDER BY inspected_at DESC",[org(req)])).rows));
router.post("/inspections", (req,res,next) => handle(res,next,async () => {
  await evaluate(req,"environment.inspection.complete@1");
  return (await db.pool.query(`INSERT INTO environmental_inspections (organisation_id,site_id,inspected_at,inspector_user_id,scope,findings,non_conformities,proof_refs,status,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[org(req),req.body.siteId,req.body.inspectedAt,req.body.inspectorUserId,req.body.scope||[],req.body.findings||[],req.body.nonConformities||[],req.body.proofRefs||[],req.body.status||"completed",req.body.completedAt||new Date()])).rows[0];
},201));

router.get("/corrective-actions", (req,res,next) => handle(res,next,async () => (await db.pool.query("SELECT * FROM environmental_corrective_actions WHERE organisation_id=$1 ORDER BY due_at",[org(req)])).rows));
router.post("/corrective-actions/:id/close", (req,res,next) => handle(res,next,async () => {
  await evaluate(req,"environment.corrective_action.close@1",{...req.body,actionId:req.params.id});
  return (await db.pool.query("UPDATE environmental_corrective_actions SET status='closed',closure_evidence=$1,closed_by=$2,closed_at=NOW() WHERE id=$3 AND organisation_id=$4 RETURNING *",[req.body.closureEvidence,req.body.closedBy,req.params.id,org(req)])).rows[0];
}));

router.get("/metrics", (req,res,next) => handle(res,next,async () => (await db.pool.query("SELECT * FROM environmental_metrics WHERE organisation_id=$1 ORDER BY period_start DESC",[org(req)])).rows));
router.post("/metrics", (req,res,next) => handle(res,next,async () => {
  await evaluate(req,"environment.metric.record@1");
  return (await db.pool.query(`INSERT INTO environmental_metrics (organisation_id,site_id,metric_type,period_start,period_end,value,unit,methodology,source_refs,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[org(req),req.body.siteId||null,req.body.metricType,req.body.periodStart,req.body.periodEnd,req.body.value,req.body.unit,req.body.methodology,req.body.sourceRefs||[],req.body.recordedBy])).rows[0];
},201));

router.get("/reports", (req,res,next) => handle(res,next,async () => (await db.pool.query("SELECT * FROM environmental_reports WHERE organisation_id=$1 ORDER BY created_at DESC",[org(req)])).rows));
router.post("/reports", (req,res,next) => handle(res,next,async () => {
  await evaluate(req,"environment.report.publish@1");
  return (await db.pool.query(`INSERT INTO environmental_reports (organisation_id,report_type,period_start,period_end,summary,indicators,risks,proof_refs,prepared_by,approved_by,status,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[org(req),req.body.reportType,req.body.periodStart,req.body.periodEnd,req.body.summary,req.body.indicators||{},req.body.risks||[],req.body.proofRefs||[],req.body.preparedBy,req.body.approvedBy,req.body.status||"published",req.body.publishedAt||new Date()])).rows[0];
},201));

router.get("/alerts", (req,res,next) => handle(res,next,async () => (await db.pool.query(`SELECT 'permit_expiry' AS alert_type,id,expires_at AS due_at FROM environmental_permits WHERE organisation_id=$1 AND status='active' AND expires_at<=CURRENT_DATE+INTERVAL '60 days' UNION ALL SELECT 'corrective_action_overdue',id,due_at FROM environmental_corrective_actions WHERE organisation_id=$1 AND status<>'closed' AND due_at<NOW() ORDER BY due_at`,[org(req)])).rows));

module.exports = router;
