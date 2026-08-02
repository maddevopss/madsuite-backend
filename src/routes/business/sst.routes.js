const express = require("express");
const pool = require("../../../db");
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const { organisationValue } = require("../../utils/organisationScope");
const { createHazard, reportIncident, transitionCorrectiveAction } = require("../../services/business/sst-transaction.service");
const { assignTraining, transitionTrainingAssignment, getEmployeeTrainingCompliance } = require("../../services/business/sst-training-compliance.service");

const router = express.Router();
// hr_employee_competencies (jointe dans /alerts) est sous RLS FORCE : sans
// ce middleware, pool.query() (alias de db.query()) n'a jamais de contexte
// ALS et retourne toujours 0 ligne pour cette jointure.
router.use(requireOrganisation);
const orgId = (req) => organisationValue(req.user?.organisation_id || req.organisation_id);
const actorId = (req) => req.user?.id || null;
const key = (req) => req.get("Idempotency-Key") || req.body?.idempotencyKey;

// Même séparation que payroll.routes.js et #707 : préparation ouverte à
// admin/manager, appliquée dès l'écriture des nouvelles routes de ce PR
// (indépendant de #707, encore en revue).
const preparer = requireRole("admin", "manager");

router.get("/hazards", async (req,res,next)=>{try{const {rows}=await pool.query(`SELECT * FROM sst_hazards WHERE organisation_id=$1 ORDER BY created_at DESC`,[orgId(req)]);res.json(rows);}catch(e){next(e);}});
router.post("/hazards", async (req,res,next)=>{try{const result=await createHazard({organisationId:orgId(req),input:req.body,idempotencyKey:key(req),createdBy:actorId(req)});res.status(201).json(result);}catch(e){next(e);}});
router.get("/incidents", async (req,res,next)=>{try{const {rows}=await pool.query(`SELECT * FROM sst_incidents WHERE organisation_id=$1 ORDER BY occurred_at DESC`,[orgId(req)]);res.json(rows);}catch(e){next(e);}});
router.post("/incidents", async (req,res,next)=>{try{const result=await reportIncident({organisationId:orgId(req),input:req.body,idempotencyKey:key(req),createdBy:actorId(req)});res.status(201).json(result);}catch(e){next(e);}});
router.get("/inspections", async (req,res,next)=>{try{const {rows}=await pool.query(`SELECT * FROM sst_inspections WHERE organisation_id=$1 ORDER BY COALESCE(scheduled_at,created_at) DESC`,[orgId(req)]);res.json(rows);}catch(e){next(e);}});
router.post("/inspections", async (req,res,next)=>{try{const number=req.body.inspectionNumber||`INS-${Date.now()}`;const {rows}=await pool.query(`INSERT INTO sst_inspections (organisation_id,inspection_number,inspection_type,location,scheduled_at,inspector_employee_id,checklist,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[orgId(req),number,req.body.inspectionType,req.body.location,req.body.scheduledAt||null,req.body.inspectorEmployeeId||null,req.body.checklist||[],actorId(req)]);res.status(201).json(rows[0]);}catch(e){next(e);}});
router.get("/corrective-actions", async (req,res,next)=>{try{const {rows}=await pool.query(`SELECT * FROM sst_corrective_actions WHERE organisation_id=$1 ORDER BY due_at ASC`,[orgId(req)]);res.json(rows);}catch(e){next(e);}});
router.post("/corrective-actions", async (req,res,next)=>{try{const {rows}=await pool.query(`INSERT INTO sst_corrective_actions (organisation_id,source_type,source_id,title,description,priority,owner_employee_id,due_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[orgId(req),req.body.sourceType,req.body.sourceId||null,req.body.title,req.body.description,req.body.priority,req.body.ownerEmployeeId||null,req.body.dueAt,actorId(req)]);res.status(201).json(rows[0]);}catch(e){next(e);}});
router.post("/corrective-actions/:id/:action", async (req,res,next)=>{try{const result=await transitionCorrectiveAction({organisationId:orgId(req),actionId:Number(req.params.id),action:req.params.action,evidence:req.body.evidence,reason:req.body.reason,idempotencyKey:key(req),createdBy:actorId(req)});if(!result)return res.status(404).json({message:"Action corrective introuvable."});res.json(result);}catch(e){next(e);}});
router.get("/ppe", async (req,res,next)=>{try{const {rows}=await pool.query(`SELECT * FROM sst_ppe_assets WHERE organisation_id=$1 ORDER BY asset_code`,[orgId(req)]);res.json(rows);}catch(e){next(e);}});
router.post("/ppe", async (req,res,next)=>{try{const {rows}=await pool.query(`INSERT INTO sst_ppe_assets (organisation_id,asset_code,ppe_type,manufacturer,model,serial_number,assigned_employee_id,issued_at,expires_at,next_inspection_at,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[orgId(req),req.body.assetCode,req.body.ppeType,req.body.manufacturer||null,req.body.model||null,req.body.serialNumber||null,req.body.assignedEmployeeId||null,req.body.issuedAt||null,req.body.expiresAt||null,req.body.nextInspectionAt||null,req.body.evidence||[]]);res.status(201).json(rows[0]);}catch(e){next(e);}});
router.get("/alerts", async (req,res,next)=>{try{const [actions,ppe,competencies]=await Promise.all([pool.query(`SELECT * FROM sst_corrective_actions WHERE organisation_id=$1 AND status NOT IN ('closed','cancelled') AND due_at<NOW()`,[orgId(req)]),pool.query(`SELECT * FROM sst_ppe_assets WHERE organisation_id=$1 AND status NOT IN ('retired','lost') AND next_inspection_at<=NOW()+INTERVAL '30 days'`,[orgId(req)]),pool.query(`SELECT ec.*,c.code,c.name,e.employee_number FROM hr_employee_competencies ec JOIN hr_competencies c ON c.id=ec.competency_id JOIN hr_employees e ON e.id=ec.employee_id WHERE ec.organisation_id=$1 AND ec.status='verified' AND ec.expires_at<=NOW()+INTERVAL '60 days'`,[orgId(req)])]);res.json({overdueCorrectiveActions:actions.rows,ppeInspectionsDue:ppe.rows,trainingExpirations:competencies.rows});}catch(e){next(e);}});

// Conformité de formation SST (2C du mandat RH/SST) : sst-complete-block
// .service.js (assessTrainingCompliance) et sst_training_assignments
// existaient sans jamais être montés sur aucune route.
router.get("/training-assignments", async (req,res,next)=>{try{const {employeeId}=req.query;const params=[orgId(req)];let where="a.organisation_id=$1";if(employeeId){params.push(employeeId);where+=` AND a.employee_id=$${params.length}`;}const {rows}=await pool.query(`SELECT a.*,e.legal_name employee_name FROM sst_training_assignments a JOIN hr_employees e ON e.id=a.employee_id AND e.organisation_id=a.organisation_id WHERE ${where} ORDER BY a.due_at NULLS LAST`,params);res.json({assignments:rows});}catch(e){next(e);}});
router.post("/training-assignments", preparer, async (req,res,next)=>{try{const result=await assignTraining({organisationId:orgId(req),input:req.body,idempotencyKey:key(req),createdBy:actorId(req)});res.status(result?.duplicate?200:201).json(result);}catch(e){next(e);}});
router.post("/training-assignments/:id/transitions/:action", preparer, async (req,res,next)=>{try{const result=await transitionTrainingAssignment({organisationId:orgId(req),assignmentId:Number(req.params.id),action:req.params.action,input:req.body,idempotencyKey:key(req),createdBy:actorId(req)});if(!result)return res.status(404).json({message:"Affectation de formation introuvable."});res.status(result.duplicate?200:201).json(result);}catch(e){next(e);}});
router.get("/employees/:employeeId/training-compliance", async (req,res,next)=>{try{const result=await getEmployeeTrainingCompliance({organisationId:orgId(req),employeeId:req.params.employeeId,db:pool});res.json(result);}catch(e){next(e);}});
// Alertes 90/60/30 jours (demandées explicitement) : trois fenêtres de
// relance plus un panier "en retard" pour les affectations actives dont
// l'échéance est déjà dépassée.
router.get("/training-compliance/alerts", async (req,res,next)=>{try{const {rows}=await pool.query(`SELECT a.*,e.legal_name employee_name,e.employee_number FROM sst_training_assignments a JOIN hr_employees e ON e.id=a.employee_id AND e.organisation_id=a.organisation_id WHERE a.organisation_id=$1 AND a.status IN ('assigned','in_progress') AND a.due_at IS NOT NULL AND a.due_at<=NOW()+INTERVAL '90 days' ORDER BY a.due_at`,[orgId(req)]);const bucket=(days)=>rows.filter(r=>new Date(r.due_at)<=new Date(Date.now()+days*86400000));res.json({overdue:rows.filter(r=>new Date(r.due_at)<new Date()),due30:bucket(30),due60:bucket(60),due90:bucket(90)});}catch(e){next(e);}});

module.exports=router;
