const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");

const HAZARD_CREATE_POLICY = "sst.hazard.create@1";
const INCIDENT_REPORT_POLICY = "sst.incident.report@1";
const ACTION_TRANSITION_POLICY = "sst.corrective_action.transition@1";
const INSPECTION_COMPLETE_POLICY = "sst.inspection.complete@1";
const PPE_INSPECT_POLICY = "sst.ppe.inspect@1";

function validIdempotency(value) { return Boolean(value && String(value).trim().length >= 8); }
function hasEvidence(value) { return Array.isArray(value) && value.length > 0; }
function riskScore(probability, severity) {
  const p = Number(probability); const s = Number(severity);
  if (!Number.isInteger(p) || !Number.isInteger(s) || p < 1 || p > 5 || s < 1 || s > 5) return null;
  return p * s;
}

registerPolicy("sst.hazard.create", "1", ({ input, idempotencyKey }) => {
  const score = riskScore(input?.probability, input?.severity);
  if (!input?.title || !input?.category || !score) return { allowed: false, statusCode: 400, code: "sst.hazard_incomplete", reason: "Le danger, sa catégorie, sa probabilité et sa gravité sont requis." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "sst.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  return { allowed: true, code: "sst.hazard_valid", riskScore: score };
});

registerPolicy("sst.incident.report", "1", ({ input, idempotencyKey }) => {
  if (!input?.incidentType || !input?.occurredAt || !input?.location || !input?.description || !input?.severity) return { allowed: false, statusCode: 400, code: "sst.incident_incomplete", reason: "Les faits minimaux de l’incident sont obligatoires." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "sst.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  return { allowed: true, code: "sst.incident_valid" };
});

registerPolicy("sst.corrective_action.transition", "1", ({ input, idempotencyKey }) => {
  const allowedActions = new Set(["assign", "start", "correct", "verify", "close", "cancel"]);
  if (!input?.actionId || !allowedActions.has(input?.action)) return { allowed: false, statusCode: 400, code: "sst.action_transition_invalid", reason: "Transition corrective invalide." };
  if (["correct", "verify"].includes(input.action) && !hasEvidence(input.evidence)) return { allowed: false, statusCode: 400, code: "sst.evidence_required", reason: "Une preuve est requise pour cette transition." };
  if (["close", "cancel"].includes(input.action) && !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, code: "sst.reason_required", reason: "Une raison est obligatoire." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "sst.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  return { allowed: true, code: "sst.action_transition_valid" };
});

registerPolicy("sst.inspection.complete", "1", ({ input, idempotencyKey }) => {
  if (!input?.inspectionId || !["pass", "conditional", "fail"].includes(input?.result)) return { allowed: false, statusCode: 400, code: "sst.inspection_result_required", reason: "Le résultat de l’inspection est obligatoire." };
  if (input.result !== "pass" && (!Array.isArray(input.findings) || input.findings.length === 0)) return { allowed: false, statusCode: 400, code: "sst.findings_required", reason: "Les constats sont obligatoires lorsque l’inspection n’est pas conforme." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "sst.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  return { allowed: true, code: "sst.inspection_valid" };
});

registerPolicy("sst.ppe.inspect", "1", ({ input, idempotencyKey }) => {
  if (!input?.assetId || !["pass", "repair", "retire"].includes(input?.result)) return { allowed: false, statusCode: 400, code: "sst.ppe_inspection_invalid", reason: "L’équipement et le résultat sont obligatoires." };
  if (input.result !== "pass" && !String(input.findings || "").trim()) return { allowed: false, statusCode: 400, code: "sst.ppe_findings_required", reason: "Un constat est requis pour réparer ou retirer un équipement." };
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "sst.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  return { allowed: true, code: "sst.ppe_inspection_valid" };
});

async function executeSstTransaction({ type, policy, organisationId, actorUserId, idempotencyKey, input, aggregateType, aggregateId, eventType, execute, trustChecks = [], graphEdges = [] }) {
  const tx = await executeTransaction({
    type, organisationId: organisationValue(organisationId), actorUserId, idempotencyKey, policies: [policy], input,
    execute: async (context) => {
      const result = await execute(context);
      if (!result) return null;
      const event = await appendEvent(context.client, { organisationId: context.organisationId, eventType, aggregateType, aggregateId: aggregateId(result), actorUserId: context.actorUserId, correlationId: context.correlationId, payload: result });
      const trust = await persistTrustAssessment(context.client, { organisationId: context.organisationId, transactionId: context.transactionId, correlationId: context.correlationId, checks: trustChecks.map((check) => check(result)) });
      const graph = await persistGraphEdges(context.client, { organisationId: context.organisationId, transactionId: context.transactionId, correlationId: context.correlationId, edges: graphEdges.map((edge) => edge(result, event, trust)) });
      return { ...result, event, trust, graph };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function createHazard({ organisationId, input, idempotencyKey, createdBy }) {
  return executeSstTransaction({ type: "sst.hazard.create", policy: HAZARD_CREATE_POLICY, organisationId, actorUserId: createdBy, idempotencyKey, input, aggregateType: "sst_hazard", aggregateId: (r) => r.hazard.id, eventType: "sst.hazard.created",
    execute: async ({ client, organisationId: orgId, transactionId, correlationId, actorUserId }) => {
      const score = riskScore(input.probability, input.severity);
      const code = input.code || `HZ-${Date.now()}`;
      const { rows } = await client.query(`INSERT INTO sst_hazards (organisation_id,code,title,description,category,location,probability,severity,risk_score,control_measures,evidence,owner_employee_id,ct_mad_transaction_id,correlation_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (organisation_id,code) DO UPDATE SET title=EXCLUDED.title RETURNING *`, [orgId,code,input.title,input.description||null,input.category,input.location||null,input.probability,input.severity,score,input.controlMeasures||[],input.evidence||[],input.ownerEmployeeId||null,transactionId,correlationId,actorUserId]);
      return { hazard: rows[0] };
    },
    trustChecks: [(r) => ({ code: "sst.hazard_risk_scored", passed: Boolean(r.hazard.risk_score), evidence: [{ riskScore: r.hazard.risk_score }] })],
    graphEdges: [(r,e) => ({ from:{type:"sst_hazard",id:r.hazard.id}, relation:"produces", to:{type:"business_event",id:e.event_id}, provenance:{eventId:e.event_id} })]
  });
}

async function reportIncident({ organisationId, input, idempotencyKey, createdBy }) {
  return executeSstTransaction({ type:"sst.incident.report", policy:INCIDENT_REPORT_POLICY, organisationId, actorUserId:createdBy, idempotencyKey, input, aggregateType:"sst_incident", aggregateId:(r)=>r.incident.id, eventType:"sst.incident.reported",
    execute: async ({client,organisationId:orgId,transactionId,correlationId,actorUserId}) => { const number=input.incidentNumber||`INC-${Date.now()}`; const {rows}=await client.query(`INSERT INTO sst_incidents (organisation_id,incident_number,incident_type,occurred_at,location,description,severity,immediate_actions,persons_involved,witnesses,evidence,reported_by,ct_mad_transaction_id,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (organisation_id,incident_number) DO UPDATE SET description=EXCLUDED.description RETURNING *`,[orgId,number,input.incidentType,input.occurredAt,input.location,input.description,input.severity,input.immediateActions||[],input.personsInvolved||[],input.witnesses||[],input.evidence||[],actorUserId,transactionId,correlationId]); return {incident:rows[0]}; },
    trustChecks:[(r)=>({code:"sst.incident_facts_recorded",passed:Boolean(r.incident.occurred_at&&r.incident.location&&r.incident.description),evidence:[{incidentNumber:r.incident.incident_number}]})],
    graphEdges:[(r,e)=>({from:{type:"sst_incident",id:r.incident.id},relation:"produces",to:{type:"business_event",id:e.event_id},provenance:{eventId:e.event_id}})]
  });
}

async function transitionCorrectiveAction({ organisationId, actionId, action, evidence, reason, idempotencyKey, createdBy }) {
  const input={actionId,action,evidence,reason}; const statusMap={assign:"assigned",start:"in_progress",correct:"corrected",verify:"verified",close:"closed",cancel:"cancelled"};
  return executeSstTransaction({type:"sst.corrective_action.transition",policy:ACTION_TRANSITION_POLICY,organisationId,actorUserId:createdBy,idempotencyKey,input,aggregateType:"sst_corrective_action",aggregateId:(r)=>r.action.id,eventType:`sst.corrective_action.${statusMap[action]}`,
    execute:async({client,organisationId:orgId,transactionId,correlationId,actorUserId})=>{const current=await client.query(`SELECT * FROM sst_corrective_actions WHERE organisation_id=$1 AND id=$2 FOR UPDATE`,[orgId,actionId]); if(!current.rows[0]) return null; const status=statusMap[action]; const correction=action==="correct"?(evidence||[]):current.rows[0].correction_evidence; const verification=action==="verify"?(evidence||[]):current.rows[0].verification_evidence; const {rows}=await client.query(`UPDATE sst_corrective_actions SET status=$1,correction_evidence=$2,verification_evidence=$3,corrected_at=CASE WHEN $1='corrected' THEN NOW() ELSE corrected_at END,verified_at=CASE WHEN $1='verified' THEN NOW() ELSE verified_at END,closed_at=CASE WHEN $1='closed' THEN NOW() ELSE closed_at END,verified_by=CASE WHEN $1='verified' THEN $4 ELSE verified_by END,closure_reason=COALESCE($5,closure_reason),ct_mad_transaction_id=$6,correlation_id=$7,updated_at=NOW() WHERE organisation_id=$8 AND id=$9 RETURNING *`,[status,correction,verification,actorUserId,reason||null,transactionId,correlationId,orgId,actionId]); return {action:rows[0]};},
    trustChecks:[(r)=>({code:"sst.action_evidence_complete",passed:!["corrected","verified"].includes(r.action.status)||hasEvidence(r.action.status==="corrected"?r.action.correction_evidence:r.action.verification_evidence),evidence:[{status:r.action.status}]})],graphEdges:[(r,e)=>({from:{type:"sst_corrective_action",id:r.action.id},relation:"produces",to:{type:"business_event",id:e.event_id},provenance:{eventId:e.event_id}})]});
}

module.exports={HAZARD_CREATE_POLICY,INCIDENT_REPORT_POLICY,ACTION_TRANSITION_POLICY,INSPECTION_COMPLETE_POLICY,PPE_INSPECT_POLICY,validIdempotency,hasEvidence,riskScore,createHazard,reportIncident,transitionCorrectiveAction};
