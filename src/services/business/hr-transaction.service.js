const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");

const EMPLOYEE_CREATE_POLICY = "hr.employee.create@1";
const EMPLOYMENT_TRANSITION_POLICY = "hr.employment.transition@1";
const LEAVE_DECIDE_POLICY = "hr.leave.decide@1";
const COMPETENCY_VERIFY_POLICY = "hr.competency.verify@1";

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("hr.employee.create", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "hr.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  if (!String(input?.employeeNumber || "").trim() || !String(input?.legalName || "").trim()) return { allowed: false, statusCode: 400, code: "hr.employee_identity_required", reason: "Le numéro et le nom légal de l’employé sont requis." };
  return { allowed: true, code: "hr.employee.valid" };
});

registerPolicy("hr.employment.transition", "1", ({ input, idempotencyKey }) => {
  const allowed = ["activate", "leave", "return", "suspend", "reinstate", "terminate", "change_role", "change_department", "change_manager"];
  if (!input?.employeeId || !allowed.includes(input.action) || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "hr.transition_invalid", reason: "Employé, transition et clé d’idempotence valides sont requis." };
  if (["terminate", "suspend"].includes(input.action) && !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, code: "hr.reason_required", reason: "Une raison est obligatoire pour cette transition." };
  return { allowed: true };
});

registerPolicy("hr.leave.decide", "1", ({ input, idempotencyKey }) => {
  if (!input?.requestId || !["approve", "reject", "cancel"].includes(input.action) || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Demande, décision et clé d’idempotence sont requises." };
  if (input.action === "reject" && !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, reason: "Une raison est obligatoire pour refuser une absence." };
  return { allowed: true };
});

registerPolicy("hr.competency.verify", "1", ({ input, idempotencyKey }) => {
  if (!input?.employeeId || !input?.competencyId || !input?.issuedAt || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Employé, compétence, date et clé d’idempotence sont requis." };
  return { allowed: true };
});

async function createEmployee({ organisationId, input, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.employee.create",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [EMPLOYEE_CREATE_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM hr_employment_events WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) {
        const employee = await client.query("SELECT * FROM hr_employees WHERE organisation_id=$1 AND id=$2", [orgId, duplicate.rows[0].employee_id]);
        return { duplicate: true, employee: employee.rows[0] };
      }
      const inserted = await client.query(`INSERT INTO hr_employees
        (organisation_id,user_id,employee_number,legal_name,preferred_name,work_email,personal_email,phone,employment_status,hire_date,manager_employee_id,department,job_title,employment_type,work_location,metadata,ct_mad_transaction_id,correlation_id,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [orgId,input.userId||null,input.employeeNumber,input.legalName,input.preferredName||null,input.workEmail||null,input.personalEmail||null,input.phone||null,input.hireDate||null,input.managerEmployeeId||null,input.department||null,input.jobTitle||null,input.employmentType||"employee",input.workLocation||null,input.metadata||{},transactionId,correlationId,actorUserId]);
      const employee = inserted.rows[0];
      await client.query(`INSERT INTO hr_employment_events (organisation_id,employee_id,event_type,effective_date,reason,previous_state,new_state,idempotency_key,ct_mad_transaction_id,correlation_id,created_by)
        VALUES ($1,$2,'hired',$3,$4,'{}',$5,$6,$7,$8,$9)`, [orgId,employee.id,input.hireDate||new Date().toISOString().slice(0,10),input.reason||null,employee,idempotencyKey,transactionId,correlationId,actorUserId]);
      for (const task of input.onboardingTasks || []) {
        await client.query(`INSERT INTO hr_onboarding_tasks (organisation_id,employee_id,title,description,category,assigned_to,due_date) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [orgId,employee.id,task.title,task.description||null,task.category||"general",task.assignedTo||null,task.dueDate||null]);
      }
      const event = await appendEvent(client,{organisationId:orgId,eventType:"hr.employee.created",aggregateType:"hr_employee",aggregateId:employee.id,actorUserId,correlationId,payload:{employeeNumber:employee.employee_number,status:employee.employment_status}});
      const trust = await persistTrustAssessment(client,{organisationId:orgId,transactionId,correlationId,checks:[{code:"hr.identity_present",passed:Boolean(employee.employee_number&&employee.legal_name),evidence:[{employeeId:employee.id}]},{code:"hr.history_created",passed:true,evidence:[{eventType:"hired"}]}]});
      const graph = await persistGraphEdges(client,{organisationId:orgId,transactionId,correlationId,edges:[{from:{type:"hr_employee",id:employee.id},relation:"produces",to:{type:"business_event",id:event.event_id},provenance:{eventId:event.event_id}},{from:{type:"madtrust_assessment",id:trust.assessmentId},relation:"assesses",to:{type:"hr_employee",id:employee.id},provenance:{transactionId}}]});
      return { duplicate:false, employee, event, trust, graph };
    },
  });
  return tx.result ? { ...tx.result, ct_mad:{transactionId:tx.transactionId,correlationId:tx.correlationId,policies:tx.policyResults} } : null;
}

function transitionSpec(action,input) {
  const map={
    activate:{status:"active",event:"activated",fields:{employment_status:"active"}},
    leave:{status:"leave",event:"leave_started",fields:{employment_status:"leave"}},
    return:{status:"active",event:"leave_ended",fields:{employment_status:"active"}},
    suspend:{status:"suspended",event:"suspended",fields:{employment_status:"suspended"}},
    reinstate:{status:"active",event:"reinstated",fields:{employment_status:"active"}},
    terminate:{status:"terminated",event:"terminated",fields:{employment_status:"terminated",termination_date:input.effectiveDate}},
    change_role:{event:"role_changed",fields:{job_title:input.jobTitle}},
    change_department:{event:"department_changed",fields:{department:input.department}},
    change_manager:{event:"manager_changed",fields:{manager_employee_id:input.managerEmployeeId||null}},
  };
  return map[action];
}

async function transitionEmployment({ organisationId, employeeId, action, input={}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({type:"hr.employment.transition",organisationId:organisationValue(organisationId),actorUserId:createdBy,idempotencyKey,policies:[EMPLOYMENT_TRANSITION_POLICY],input:{...input,employeeId,action},execute:async({client,transactionId,correlationId,organisationId:orgId,actorUserId})=>{
    const dup=await client.query("SELECT * FROM hr_employment_events WHERE organisation_id=$1 AND idempotency_key=$2",[orgId,idempotencyKey]);
    if(dup.rows[0]) return {duplicate:true,event:dup.rows[0]};
    const locked=await client.query("SELECT * FROM hr_employees WHERE organisation_id=$1 AND id=$2 FOR UPDATE",[orgId,employeeId]);
    const employee=locked.rows[0]; if(!employee) return null;
    const spec=transitionSpec(action,input); if(!spec) throw Object.assign(new Error("Transition RH inconnue."),{statusCode:400});
    const keys=Object.keys(spec.fields); const values=Object.values(spec.fields); if(values.some(v=>v===undefined)) throw Object.assign(new Error("Les nouvelles données de la transition sont incomplètes."),{statusCode:400});
    const setSql=keys.map((k,i)=>`${k}=$${i+1}`).join(",");
    const updated=await client.query(`UPDATE hr_employees SET ${setSql},updated_at=NOW(),ct_mad_transaction_id=$${keys.length+1},correlation_id=$${keys.length+2} WHERE organisation_id=$${keys.length+3} AND id=$${keys.length+4} RETURNING *`,[...values,transactionId,correlationId,orgId,employeeId]);
    const next=updated.rows[0]; const effectiveDate=input.effectiveDate||new Date().toISOString().slice(0,10);
    const history=await client.query(`INSERT INTO hr_employment_events (organisation_id,employee_id,event_type,effective_date,reason,previous_state,new_state,idempotency_key,ct_mad_transaction_id,correlation_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[orgId,employeeId,spec.event,effectiveDate,input.reason||null,employee,next,idempotencyKey,transactionId,correlationId,actorUserId]);
    const event=await appendEvent(client,{organisationId:orgId,eventType:`hr.employee.${spec.event}`,aggregateType:"hr_employee",aggregateId:employeeId,actorUserId,correlationId,payload:{effectiveDate,reason:input.reason||null,previousStatus:employee.employment_status,newStatus:next.employment_status}});
    const trust=await persistTrustAssessment(client,{organisationId:orgId,transactionId,correlationId,checks:[{code:"hr.transition_recorded",passed:true,evidence:[{historyId:history.rows[0].id,eventType:spec.event}]},{code:"hr.reason_present_when_required",passed:!["terminate","suspend"].includes(action)||Boolean(input.reason),evidence:[{action}]}]});
    return {duplicate:false,employee:next,history:history.rows[0],event,trust};
  }});
  return tx.result ? {...tx.result,ct_mad:{transactionId:tx.transactionId,correlationId:tx.correlationId,policies:tx.policyResults}} : null;
}

async function decideLeave({ organisationId, requestId, action, reason, idempotencyKey, createdBy }) {
  const tx=await executeTransaction({type:"hr.leave.decide",organisationId:organisationValue(organisationId),actorUserId:createdBy,idempotencyKey,policies:[LEAVE_DECIDE_POLICY],input:{requestId,action,reason},execute:async({client,transactionId,correlationId,organisationId:orgId,actorUserId})=>{
    const locked=await client.query("SELECT * FROM hr_leave_requests WHERE organisation_id=$1 AND id=$2 FOR UPDATE",[orgId,requestId]); const request=locked.rows[0]; if(!request)return null;
    if(request.status!=="pending") throw Object.assign(new Error("Seule une demande en attente peut être décidée."),{statusCode:409});
    const status=action==="approve"?"approved":action==="reject"?"rejected":"cancelled";
    const updated=await client.query("UPDATE hr_leave_requests SET status=$1,decision_reason=$2,approved_by=$3,decided_at=NOW(),ct_mad_transaction_id=$4,correlation_id=$5 WHERE organisation_id=$6 AND id=$7 RETURNING *",[status,reason||null,actorUserId,transactionId,correlationId,orgId,requestId]);
    const event=await appendEvent(client,{organisationId:orgId,eventType:`hr.leave.${status}`,aggregateType:"hr_leave_request",aggregateId:requestId,actorUserId,correlationId,payload:{employeeId:request.employee_id,startDate:request.start_date,endDate:request.end_date,reason:reason||null}});
    const trust=await persistTrustAssessment(client,{organisationId:orgId,transactionId,correlationId,checks:[{code:"hr.leave_decision_recorded",passed:updated.rows[0].status===status,evidence:[{status}]}]});
    return {request:updated.rows[0],event,trust};
  }});
  return tx.result ? {...tx.result,ct_mad:{transactionId:tx.transactionId,correlationId:tx.correlationId,policies:tx.policyResults}} : null;
}

async function verifyCompetency({ organisationId, input, idempotencyKey, createdBy }) {
  const tx=await executeTransaction({type:"hr.competency.verify",organisationId:organisationValue(organisationId),actorUserId:createdBy,idempotencyKey,policies:[COMPETENCY_VERIFY_POLICY],input,execute:async({client,transactionId,correlationId,organisationId:orgId,actorUserId})=>{
    const competency=await client.query("SELECT * FROM hr_competencies WHERE organisation_id=$1 AND id=$2 AND is_active=TRUE",[orgId,input.competencyId]); if(!competency.rows[0])return null;
    const duplicate=await client.query("SELECT * FROM hr_employee_competencies WHERE organisation_id=$1 AND idempotency_key=$2",[orgId,idempotencyKey]); if(duplicate.rows[0])return {duplicate:true,employeeCompetency:duplicate.rows[0]};
    let expiresAt=input.expiresAt||null; if(!expiresAt&&competency.rows[0].validity_days){const d=new Date(input.issuedAt);d.setUTCDate(d.getUTCDate()+Number(competency.rows[0].validity_days));expiresAt=d.toISOString().slice(0,10);}
    const inserted=await client.query(`INSERT INTO hr_employee_competencies (organisation_id,employee_id,competency_id,issued_at,expires_at,status,evidence,verified_by,verified_at,idempotency_key,ct_mad_transaction_id,correlation_id) VALUES ($1,$2,$3,$4,$5,'valid',$6,$7,NOW(),$8,$9,$10) RETURNING *`,[orgId,input.employeeId,input.competencyId,input.issuedAt,expiresAt,input.evidence||[],actorUserId,idempotencyKey,transactionId,correlationId]);
    const event=await appendEvent(client,{organisationId:orgId,eventType:"hr.competency.verified",aggregateType:"hr_employee",aggregateId:input.employeeId,actorUserId,correlationId,payload:{competencyId:input.competencyId,issuedAt:input.issuedAt,expiresAt}});
    const trust=await persistTrustAssessment(client,{organisationId:orgId,transactionId,correlationId,checks:[{code:"hr.competency_verified",passed:true,evidence:[{competencyId:input.competencyId,expiresAt}]},{code:"hr.competency_evidence",passed:Array.isArray(input.evidence)&&input.evidence.length>0,evidence:input.evidence||[]}]});
    return {duplicate:false,employeeCompetency:inserted.rows[0],event,trust};
  }});
  return tx.result ? {...tx.result,ct_mad:{transactionId:tx.transactionId,correlationId:tx.correlationId,policies:tx.policyResults}} : null;
}

module.exports={EMPLOYEE_CREATE_POLICY,EMPLOYMENT_TRANSITION_POLICY,LEAVE_DECIDE_POLICY,COMPETENCY_VERIFY_POLICY,validIdempotency,transitionSpec,createEmployee,transitionEmployment,decideLeave,verifyCompetency};
