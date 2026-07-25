const express = require("express");
const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");

const router = express.Router();
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const actor = (req) => req.user?.id || req.user?.userId || null;
const key = (req) => req.get("Idempotency-Key") || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => res.status(status).json(data)).catch(next);

router.get("/plans", (req, res, next) => handle(res, next, async () => (await db.pool.query("SELECT * FROM quality_control_plans WHERE organisation_id=$1 ORDER BY code, version DESC", [org(req)])).rows));
router.post("/plans", (req, res, next) => handle(res, next, async () => (await db.pool.query(`INSERT INTO quality_control_plans (organisation_id,code,title,scope_type,scope_reference,version,sampling_method,acceptance_criteria,checklist,evidence_requirements,effective_from,review_due_at,owner_user_id,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [org(req),req.body.code,req.body.title,req.body.scopeType,req.body.scopeReference||null,req.body.version,req.body.samplingMethod||null,req.body.acceptanceCriteria||[],req.body.checklist||[],req.body.evidenceRequirements||[],req.body.effectiveFrom||null,req.body.reviewDueAt||null,req.body.ownerUserId||null,key(req),actor(req)])).rows[0], 201));

router.get("/inspections", (req, res, next) => handle(res, next, async () => (await db.pool.query("SELECT * FROM quality_inspections WHERE organisation_id=$1 ORDER BY inspected_at DESC", [org(req)])).rows));
router.post("/inspections", (req, res, next) => handle(res, next, async () => (await db.pool.query(`INSERT INTO quality_inspections (organisation_id,inspection_number,plan_id,subject_type,subject_id,lot_number,inspected_at,inspector_user_id,sample_size,accepted_quantity,rejected_quantity,result,findings,evidence,reason,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,NOW()),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`, [org(req),req.body.inspectionNumber,req.body.planId||null,req.body.subjectType,String(req.body.subjectId),req.body.lotNumber||null,req.body.inspectedAt||null,req.body.inspectorUserId||actor(req),req.body.sampleSize||0,req.body.acceptedQuantity||0,req.body.rejectedQuantity||0,req.body.result||"pending",req.body.findings||[],req.body.evidence||[],req.body.reason||null,key(req),actor(req)])).rows[0], 201));

router.get("/nonconformities", (req, res, next) => handle(res, next, async () => (await db.pool.query("SELECT * FROM quality_nonconformities WHERE organisation_id=$1 ORDER BY created_at DESC", [org(req)])).rows));
router.post("/nonconformities", (req, res, next) => handle(res, next, async () => (await db.pool.query(`INSERT INTO quality_nonconformities (organisation_id,nonconformity_number,inspection_id,source_type,source_id,title,description,severity,owner_user_id,due_at,evidence,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [org(req),req.body.nonconformityNumber,req.body.inspectionId||null,req.body.sourceType,req.body.sourceId||null,req.body.title,req.body.description,req.body.severity||"medium",req.body.ownerUserId||null,req.body.dueAt||null,req.body.evidence||[],key(req),actor(req)])).rows[0], 201));

router.get("/actions", (req, res, next) => handle(res, next, async () => (await db.pool.query("SELECT * FROM quality_corrective_actions WHERE organisation_id=$1 ORDER BY due_at NULLS LAST, created_at DESC", [org(req)])).rows));
router.post("/actions", (req, res, next) => handle(res, next, async () => (await db.pool.query(`INSERT INTO quality_corrective_actions (organisation_id,action_number,nonconformity_id,action_type,description,owner_user_id,due_at,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [org(req),req.body.actionNumber,req.body.nonconformityId,req.body.actionType,req.body.description,req.body.ownerUserId||null,req.body.dueAt||null,key(req),actor(req)])).rows[0], 201));

router.get("/audits", (req, res, next) => handle(res, next, async () => (await db.pool.query("SELECT * FROM quality_audits WHERE organisation_id=$1 ORDER BY planned_at NULLS LAST, created_at DESC", [org(req)])).rows));
router.post("/audits", (req, res, next) => handle(res, next, async () => (await db.pool.query(`INSERT INTO quality_audits (organisation_id,audit_number,audit_type,scope,standard_reference,planned_at,lead_auditor_user_id,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [org(req),req.body.auditNumber,req.body.auditType,req.body.scope,req.body.standardReference||null,req.body.plannedAt||null,req.body.leadAuditorUserId||null,key(req),actor(req)])).rows[0], 201));

router.get("/alerts", (req, res, next) => handle(res, next, async () => {
  const organisationId = org(req);
  const [nonconformities, actions, audits, reviews] = await Promise.all([
    db.pool.query("SELECT id,nonconformity_number,title,severity,due_at FROM quality_nonconformities WHERE organisation_id=$1 AND status NOT IN ('verified','closed','cancelled') AND due_at<=NOW()+INTERVAL '30 days' ORDER BY due_at", [organisationId]),
    db.pool.query("SELECT id,action_number,description,status,due_at FROM quality_corrective_actions WHERE organisation_id=$1 AND status NOT IN ('effectiveness_verified','closed','cancelled') AND due_at<=NOW()+INTERVAL '30 days' ORDER BY due_at", [organisationId]),
    db.pool.query("SELECT id,audit_number,audit_type,scope,planned_at FROM quality_audits WHERE organisation_id=$1 AND status='planned' AND planned_at<=NOW()+INTERVAL '30 days' ORDER BY planned_at", [organisationId]),
    db.pool.query("SELECT id,code,title,version,review_due_at FROM quality_control_plans WHERE organisation_id=$1 AND status IN ('approved','active') AND review_due_at<=CURRENT_DATE+INTERVAL '60 days' ORDER BY review_due_at", [organisationId]),
  ]);
  return { nonconformities: nonconformities.rows, actions: actions.rows, audits: audits.rows, planReviews: reviews.rows };
}));

module.exports = router;
