const express = require("express");
const db = require("../../../db");
const { requireOrganisation } = require('../../middleware/organization.middleware');
const { createObligation, assessCompliance, transitionRecord, validIdempotency } = require("../../services/business/legal-compliance-transaction.service");
const { organisationValue } = require("../../utils/organisationScope");

const router = express.Router();
router.use(requireOrganisation);
const actor = (req) => req.user?.id || req.user?.userId || null;
const org = (req) => organisationValue(req.organisationId || req.user?.organisation_id);
const key = (req) => req.get("Idempotency-Key") || req.body?.idempotencyKey;
const handle = (res, next, fn, status = 200) => Promise.resolve(fn()).then((data) => data ? res.status(status).json(data) : res.status(404).json({ code: "LEGAL_RECORD_NOT_FOUND" })).catch(next);

router.get("/obligations", (req,res,next) => handle(res,next,async()=> (await db.query(`SELECT * FROM legal_obligations WHERE organisation_id=$1 ORDER BY effective_from DESC, id DESC`,[org(req)])).rows));
router.post("/obligations", (req,res,next) => handle(res,next,()=>createObligation({ organisationId:org(req), input:req.body, idempotencyKey:key(req), createdBy:actor(req) }),201));
router.post("/obligations/:id/assessments", (req,res,next) => handle(res,next,()=>assessCompliance({ organisationId:org(req), input:{...req.body,obligationId:Number(req.params.id)}, idempotencyKey:key(req), createdBy:actor(req) }),201));
router.get("/assessments", (req,res,next) => handle(res,next,async()=> (await db.query(`SELECT a.*,o.code obligation_code,o.title obligation_title FROM legal_compliance_assessments a JOIN legal_obligations o ON o.id=a.obligation_id AND o.organisation_id=a.organisation_id WHERE a.organisation_id=$1 ORDER BY a.assessed_at DESC`,[org(req)])).rows));

router.get("/contracts", (req,res,next) => handle(res,next,async()=> (await db.query(`SELECT * FROM legal_contracts WHERE organisation_id=$1 ORDER BY created_at DESC`,[org(req)])).rows));
router.post("/contracts", (req,res,next) => handle(res,next,async()=> (await db.query(`INSERT INTO legal_contracts (organisation_id,contract_number,title,contract_type,counterparty_name,starts_at,ends_at,renewal_type,notice_days,owner_user_id,terms,evidence,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[org(req),req.body.contractNumber,req.body.title,req.body.contractType,req.body.counterpartyName,req.body.startsAt||null,req.body.endsAt||null,req.body.renewalType||"none",req.body.noticeDays||null,req.body.ownerUserId||null,JSON.stringify(req.body.terms||{}),JSON.stringify(req.body.evidence||[]),actor(req)])).rows[0],201));
router.post("/contracts/:id/:action", (req,res,next) => handle(res,next,()=>transitionRecord({ organisationId:org(req), kind:"contract", id:Number(req.params.id), action:req.params.action, reason:req.body.reason, evidence:req.body.evidence||[], idempotencyKey:key(req), createdBy:actor(req) })));

router.get("/policies", (req,res,next) => handle(res,next,async()=> (await db.query(`SELECT * FROM legal_policies WHERE organisation_id=$1 ORDER BY code,created_at DESC`,[org(req)])).rows));
router.post("/policies", (req,res,next) => handle(res,next,async()=> { const contentChecksum=require("crypto").createHash("sha256").update(JSON.stringify(req.body.content||{})).digest("hex"); return (await db.query(`INSERT INTO legal_policies (organisation_id,code,title,version,content,effective_from,effective_to,review_due_at,owner_user_id,content_checksum,supersedes_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[org(req),req.body.code,req.body.title,req.body.version,JSON.stringify(req.body.content||{}),req.body.effectiveFrom||null,req.body.effectiveTo||null,req.body.reviewDueAt||null,req.body.ownerUserId||null,contentChecksum,req.body.supersedesId||null,actor(req)])).rows[0]; },201));
router.post("/policies/:id/acknowledgements", (req,res,next) => { if (!validIdempotency(key(req))) return res.status(400).json({ code: "LEGAL_IDEMPOTENCY_REQUIRED" }); return handle(res,next,async()=> (await db.query(`INSERT INTO legal_policy_acknowledgements (organisation_id,policy_id,employee_id,evidence,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (organisation_id,policy_id,employee_id) DO UPDATE SET evidence=EXCLUDED.evidence,acknowledged_at=NOW() RETURNING *`,[org(req),Number(req.params.id),req.body.employeeId,JSON.stringify(req.body.evidence||[]),key(req),actor(req)])).rows[0],201); });

router.get("/matters", (req,res,next) => handle(res,next,async()=> (await db.query(`SELECT * FROM legal_matters WHERE organisation_id=$1 ORDER BY opened_at DESC`,[org(req)])).rows));
router.post("/matters", (req,res,next) => handle(res,next,async()=> (await db.query(`INSERT INTO legal_matters (organisation_id,matter_number,matter_type,title,description,risk_level,owner_user_id,due_at,evidence,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[org(req),req.body.matterNumber,req.body.matterType,req.body.title,req.body.description,req.body.riskLevel||"medium",req.body.ownerUserId||null,req.body.dueAt||null,JSON.stringify(req.body.evidence||[]),actor(req)])).rows[0],201));
router.post("/matters/:id/:action", (req,res,next) => handle(res,next,()=>transitionRecord({ organisationId:org(req), kind:"matter", id:Number(req.params.id), action:req.params.action, reason:req.body.reason, evidence:req.body.evidence||[], idempotencyKey:key(req), createdBy:actor(req) })));

router.get("/alerts", (req,res,next) => handle(res,next,async()=> { const organisationId=org(req); const [obligations,contracts,policies,matters]=await Promise.all([
  db.query(`SELECT id,code,title,review_due_at FROM legal_obligations WHERE organisation_id=$1 AND status='active' AND review_due_at<=CURRENT_DATE+INTERVAL '60 days' ORDER BY review_due_at`,[organisationId]),
  db.query(`SELECT id,contract_number,title,ends_at,renewal_type,notice_days FROM legal_contracts WHERE organisation_id=$1 AND status IN ('signed','active') AND ends_at<=CURRENT_DATE+INTERVAL '90 days' ORDER BY ends_at`,[organisationId]),
  db.query(`SELECT id,code,title,version,review_due_at FROM legal_policies WHERE organisation_id=$1 AND status='published' AND review_due_at<=CURRENT_DATE+INTERVAL '60 days' ORDER BY review_due_at`,[organisationId]),
  db.query(`SELECT id,matter_number,title,risk_level,due_at FROM legal_matters WHERE organisation_id=$1 AND status NOT IN ('closed','cancelled') AND due_at<=NOW()+INTERVAL '30 days' ORDER BY due_at`,[organisationId])]); return { obligations:obligations.rows,contracts:contracts.rows,policies:policies.rows,matters:matters.rows }; }));

module.exports = router;
