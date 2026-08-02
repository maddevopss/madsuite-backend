const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const { createEmployee, transitionEmployment, decideLeave, verifyCompetency } = require("../../services/business/hr-transaction.service");
const { createPosition, updatePosition, setPositionRequiredCompetencies, assignEmployeePosition, getEmployeeQualificationGaps } = require("../../services/business/hr-position.service");

router.use(requireOrganisation);
router.use(requireRole("admin"));

function idempotency(req) { return req.get("Idempotency-Key") || req.body?.idempotencyKey; }

router.get("/employees", async (req,res,next)=>{try{const {rows}=await req.db.query("SELECT * FROM hr_employees WHERE organisation_id=$1 ORDER BY legal_name",[req.organisationId]);res.json({employees:rows});}catch(e){next(e);}});
router.get("/employees/:id", async (req,res,next)=>{try{const employee=await req.db.query("SELECT * FROM hr_employees WHERE organisation_id=$1 AND id=$2",[req.organisationId,req.params.id]);if(!employee.rows[0])return res.status(404).json({error:"Employé introuvable."});const [events,tasks,leaves,competencies]=await Promise.all([
  req.db.query("SELECT * FROM hr_employment_events WHERE organisation_id=$1 AND employee_id=$2 ORDER BY effective_date DESC, id DESC",[req.organisationId,req.params.id]),
  req.db.query("SELECT * FROM hr_onboarding_tasks WHERE organisation_id=$1 AND employee_id=$2 ORDER BY status,due_date",[req.organisationId,req.params.id]),
  req.db.query("SELECT * FROM hr_leave_requests WHERE organisation_id=$1 AND employee_id=$2 ORDER BY start_date DESC",[req.organisationId,req.params.id]),
  req.db.query(`SELECT ec.*,c.code,c.name FROM hr_employee_competencies ec JOIN hr_competencies c ON c.id=ec.competency_id WHERE ec.organisation_id=$1 AND ec.employee_id=$2 ORDER BY ec.expires_at NULLS LAST`,[req.organisationId,req.params.id])]);res.json({employee:employee.rows[0],events:events.rows,onboardingTasks:tasks.rows,leaveRequests:leaves.rows,competencies:competencies.rows});}catch(e){next(e);}});
router.post("/employees", async (req,res,next)=>{try{const result=await createEmployee({organisationId:req.organisationId,input:req.body,idempotencyKey:idempotency(req),createdBy:req.user?.id});res.status(result?.duplicate?200:201).json(result);}catch(e){next(e);}});
router.post("/employees/:id/transitions/:action", async (req,res,next)=>{try{const result=await transitionEmployment({organisationId:req.organisationId,employeeId:req.params.id,action:req.params.action,input:req.body,idempotencyKey:idempotency(req),createdBy:req.user?.id});if(!result)return res.status(404).json({error:"Employé introuvable."});res.json(result);}catch(e){next(e);}});

router.get("/onboarding", async(req,res,next)=>{try{const {rows}=await req.db.query(`SELECT t.*,e.legal_name employee_name FROM hr_onboarding_tasks t JOIN hr_employees e ON e.id=t.employee_id WHERE t.organisation_id=$1 ORDER BY t.status,t.due_date`,[req.organisationId]);res.json({tasks:rows});}catch(e){next(e);}});
router.post("/onboarding/:id/complete", async(req,res,next)=>{try{const {rows}=await req.db.query(`UPDATE hr_onboarding_tasks SET status='completed',evidence=$1,completed_at=NOW(),completed_by=$2 WHERE organisation_id=$3 AND id=$4 AND status IN ('pending','in_progress') RETURNING *`,[req.body.evidence||[],req.user?.id,req.organisationId,req.params.id]);if(!rows[0])return res.status(404).json({error:"Tâche introuvable ou déjà fermée."});res.json({task:rows[0]});}catch(e){next(e);}});

router.get("/leave-requests", async(req,res,next)=>{try{const {rows}=await req.db.query(`SELECT l.*,e.legal_name employee_name FROM hr_leave_requests l JOIN hr_employees e ON e.id=l.employee_id WHERE l.organisation_id=$1 ORDER BY l.start_date DESC`,[req.organisationId]);res.json({leaveRequests:rows});}catch(e){next(e);}});
router.post("/leave-requests", async(req,res,next)=>{try{const {rows}=await req.db.query(`INSERT INTO hr_leave_requests (organisation_id,employee_id,leave_type,start_date,end_date,requested_units,unit,reason,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[req.organisationId,req.body.employeeId,req.body.leaveType,req.body.startDate,req.body.endDate,req.body.requestedUnits,req.body.unit||"day",req.body.reason||null,idempotency(req),req.user?.id]);res.status(201).json({leaveRequest:rows[0]});}catch(e){next(e);}});
router.post("/leave-requests/:id/:action", async(req,res,next)=>{try{const result=await decideLeave({organisationId:req.organisationId,requestId:req.params.id,action:req.params.action,reason:req.body.reason,idempotencyKey:idempotency(req),createdBy:req.user?.id});if(!result)return res.status(404).json({error:"Demande introuvable."});res.json(result);}catch(e){next(e);}});

router.get("/competencies", async(req,res,next)=>{try{const {rows}=await req.db.query("SELECT * FROM hr_competencies WHERE organisation_id=$1 ORDER BY name",[req.organisationId]);res.json({competencies:rows});}catch(e){next(e);}});
router.post("/competencies", async(req,res,next)=>{try{const {rows}=await req.db.query(`INSERT INTO hr_competencies (organisation_id,code,name,description,validity_days,is_required) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,[req.organisationId,req.body.code,req.body.name,req.body.description||null,req.body.validityDays||null,Boolean(req.body.isRequired)]);res.status(201).json({competency:rows[0]});}catch(e){next(e);}});
router.post("/employee-competencies", async(req,res,next)=>{try{const result=await verifyCompetency({organisationId:req.organisationId,input:req.body,idempotencyKey:idempotency(req),createdBy:req.user?.id});if(!result)return res.status(404).json({error:"Compétence introuvable."});res.status(result.duplicate?200:201).json(result);}catch(e){next(e);}});
router.get("/alerts", async(req,res,next)=>{try{const {rows}=await req.db.query(`SELECT ec.*,e.legal_name,c.code,c.name FROM hr_employee_competencies ec JOIN hr_employees e ON e.id=ec.employee_id JOIN hr_competencies c ON c.id=ec.competency_id WHERE ec.organisation_id=$1 AND ec.status='valid' AND ec.expires_at IS NOT NULL AND ec.expires_at <= CURRENT_DATE + INTERVAL '60 days' ORDER BY ec.expires_at`,[req.organisationId]);res.json({alerts:rows});}catch(e){next(e);}});

// Postes et matrice de compétences requises (mandat 1.A/1.E) : nouvelle
// entité, aucun orphelin -- job_title reste un champ texte sur hr_employees,
// conservé pour compatibilité arrière.
router.get("/positions", async(req,res,next)=>{try{const {rows}=await req.db.query("SELECT * FROM hr_positions WHERE organisation_id=$1 ORDER BY title",[req.organisationId]);res.json({positions:rows});}catch(e){next(e);}});
router.post("/positions", async(req,res,next)=>{try{const result=await createPosition({organisationId:req.organisationId,input:req.body,idempotencyKey:idempotency(req),createdBy:req.user?.id});res.status(result?.duplicate?200:201).json(result);}catch(e){if(e.code==="23505")return res.status(409).json({error:"Ce code de poste existe déjà pour cette organisation."});next(e);}});
router.patch("/positions/:id", async(req,res,next)=>{try{const result=await updatePosition({organisationId:req.organisationId,positionId:req.params.id,input:req.body,db:req.db});if(!result)return res.status(404).json({error:"Poste introuvable."});res.json(result);}catch(e){next(e);}});
router.put("/positions/:id/required-competencies", async(req,res,next)=>{try{const result=await setPositionRequiredCompetencies({organisationId:req.organisationId,positionId:req.params.id,competencyIds:req.body.competencyIds||[],db:req.db});if(!result)return res.status(404).json({error:"Poste introuvable."});res.json(result);}catch(e){next(e);}});
router.patch("/employees/:id/position", async(req,res,next)=>{try{const result=await assignEmployeePosition({organisationId:req.organisationId,employeeId:req.params.id,positionId:req.body.positionId,db:req.db});if(!result)return res.status(404).json({error:"Employé introuvable."});res.json(result);}catch(e){next(e);}});
router.get("/employees/:id/qualification-gaps", async(req,res,next)=>{try{const result=await getEmployeeQualificationGaps({organisationId:req.organisationId,employeeId:req.params.id,db:req.db});if(!result)return res.status(404).json({error:"Employé introuvable."});res.json(result);}catch(e){next(e);}});

module.exports=router;
