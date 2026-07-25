const crypto = require("crypto");
const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");

const OBLIGATION_CREATE_POLICY = "legal.obligation.create@1";
const CONTRACT_TRANSITION_POLICY = "legal.contract.transition@1";
const POLICY_PUBLISH_POLICY = "legal.policy.publish@1";
const ACKNOWLEDGE_POLICY = "legal.policy.acknowledge@1";
const ASSESS_POLICY = "legal.compliance.assess@1";
const MATTER_TRANSITION_POLICY = "legal.matter.transition@1";

function validIdempotency(value) { return Boolean(value && String(value).trim().length >= 8); }
function checksum(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hasEvidence(value) { return Array.isArray(value) && value.length > 0; }
function validSource(input = {}) { return Boolean(input.authority && input.sourceUrl && input.version && input.effectiveFrom); }

registerPolicy("legal.obligation.create", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "legal.idempotency_invalid", reason: "Une clé d’idempotence valide est obligatoire." };
  if (!input?.code || !input?.title || !input?.jurisdiction || !validSource(input)) return { allowed: false, statusCode: 400, code: "legal.source_required", reason: "Une obligation exige une juridiction, une autorité, une source, une version et une date d’effet." };
  return { allowed: true, code: "legal.obligation.valid" };
});
registerPolicy("legal.contract.transition", "1", ({ input, idempotencyKey }) => {
  if (!input?.contractId || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "legal.contract_transition_invalid" };
  if (["signed", "active"].includes(input.action) && !hasEvidence(input.evidence)) return { allowed: false, statusCode: 400, code: "legal.signature_evidence_required", reason: "Une signature ou activation exige une preuve." };
  if (["terminated", "cancelled"].includes(input.action) && !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, code: "legal.reason_required", reason: "Une raison est obligatoire." };
  return { allowed: true };
});
registerPolicy("legal.policy.publish", "1", ({ input, idempotencyKey }) => {
  if (!input?.policyId || !validIdempotency(idempotencyKey) || !hasEvidence(input.approvalEvidence)) return { allowed: false, statusCode: 400, code: "legal.policy_approval_evidence_required", reason: "La publication exige une approbation prouvée." };
  return { allowed: true };
});
registerPolicy("legal.policy.acknowledge", "1", ({ input, idempotencyKey }) => {
  if (!input?.policyId || !input?.employeeId || !validIdempotency(idempotencyKey) || !hasEvidence(input.evidence)) return { allowed: false, statusCode: 400, code: "legal.acknowledgement_evidence_required" };
  return { allowed: true };
});
registerPolicy("legal.compliance.assess", "1", ({ input, idempotencyKey }) => {
  if (!input?.obligationId || !input?.status || !String(input.rationale || "").trim() || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "legal.assessment_incomplete" };
  if (input.status === "compliant" && !hasEvidence(input.evidence)) return { allowed: false, statusCode: 400, code: "legal.compliance_evidence_required", reason: "La conformité ne peut pas être déclarée sans preuve." };
  return { allowed: true };
});
registerPolicy("legal.matter.transition", "1", ({ input, idempotencyKey }) => {
  if (!input?.matterId || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: "legal.matter_transition_invalid" };
  if (["closed", "cancelled", "settled"].includes(input.action) && !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, code: "legal.reason_required" };
  return { allowed: true };
});

async function createObligation({ organisationId, input, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({ type: "legal.obligation.create", organisationId: organisationValue(organisationId), actorUserId: createdBy, idempotencyKey, policies: [OBLIGATION_CREATE_POLICY], input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const source = { authority: input.authority, sourceUrl: input.sourceUrl, sourceTitle: input.sourceTitle || null, version: input.version, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo || null, requirements: input.requirements || [] };
      const sourceChecksum = checksum(source);
      const { rows } = await client.query(`INSERT INTO legal_obligations (organisation_id,code,title,jurisdiction,authority,source_url,source_title,version,effective_from,effective_to,review_due_at,applicability,requirements,evidence_requirements,status,source_checksum,supersedes_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15,$16,$17) RETURNING *`, [orgId,input.code,input.title,input.jurisdiction,input.authority,input.sourceUrl,input.sourceTitle||null,input.version,input.effectiveFrom,input.effectiveTo||null,input.reviewDueAt||null,input.applicability||{},input.requirements||[],input.evidenceRequirements||[],sourceChecksum,input.supersedesId||null,actorUserId]);
      const obligation = rows[0];
      const event = await appendEvent(client, { organisationId: orgId, eventType: "legal.obligation.created", aggregateType: "legal_obligation", aggregateId: obligation.id, actorUserId, correlationId, payload: { code: obligation.code, version: obligation.version, sourceChecksum } });
      const trust = await persistTrustAssessment(client, { organisationId: orgId, transactionId, correlationId, checks: [{ code: "legal.source_traceable", passed: validSource(input), evidence: [source] }, { code: "legal.source_checksummed", passed: Boolean(sourceChecksum), evidence: [{ sourceChecksum }] }] });
      const graph = await persistGraphEdges(client, { organisationId: orgId, transactionId, correlationId, edges: [{ from: { type: "legal_obligation", id: obligation.id }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } }, { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: "legal_obligation", id: obligation.id }, provenance: { transactionId } }] });
      return { obligation, event, trust, graph };
    }});
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function assessCompliance({ organisationId, input, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({ type: "legal.compliance.assess", organisationId: organisationValue(organisationId), actorUserId: createdBy, idempotencyKey, policies: [ASSESS_POLICY], input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const { rows } = await client.query(`SELECT * FROM legal_obligations WHERE organisation_id=$1 AND id=$2 AND status='active'`, [orgId,input.obligationId]);
      const obligation = rows[0]; if (!obligation) return null;
      const snapshot = { code: obligation.code, version: obligation.version, sourceUrl: obligation.source_url, sourceChecksum: obligation.source_checksum, requirements: obligation.requirements, evidenceRequirements: obligation.evidence_requirements };
      const inserted = await client.query(`INSERT INTO legal_compliance_assessments (organisation_id,obligation_id,status,next_review_at,rationale,evidence,assessor_user_id,source_snapshot,source_checksum,ct_mad_transaction_id,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [orgId,obligation.id,input.status,input.nextReviewAt||null,input.rationale,input.evidence||[],actorUserId,snapshot,obligation.source_checksum,transactionId,correlationId]);
      const assessment = inserted.rows[0];
      const event = await appendEvent(client, { organisationId: orgId, eventType: "legal.compliance.assessed", aggregateType: "legal_obligation", aggregateId: obligation.id, actorUserId, correlationId, payload: { status: input.status, assessmentId: assessment.id, sourceChecksum: obligation.source_checksum } });
      const trust = await persistTrustAssessment(client, { organisationId: orgId, transactionId, correlationId, checks: [{ code: "legal.source_version_preserved", passed: Boolean(snapshot.version && snapshot.sourceChecksum), evidence: [snapshot] }, { code: "legal.compliance_evidenced", passed: input.status !== "compliant" || hasEvidence(input.evidence), evidence: input.evidence || [] }] });
      return { assessment, event, trust };
    }});
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function transitionRecord({ organisationId, kind, id, action, reason, evidence = [], idempotencyKey, createdBy }) {
  const config = kind === "contract" ? { table: "legal_contracts", policy: CONTRACT_TRANSITION_POLICY, type: "legal.contract", idField: "contractId" } : { table: "legal_matters", policy: MATTER_TRANSITION_POLICY, type: "legal.matter", idField: "matterId" };
  const input = { [config.idField]: id, action, reason, evidence };
  const tx = await executeTransaction({ type: `${config.type}.transition`, organisationId: organisationValue(organisationId), actorUserId: createdBy, idempotencyKey, policies: [config.policy], input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const { rows } = await client.query(`SELECT * FROM ${config.table} WHERE organisation_id=$1 AND id=$2 FOR UPDATE`, [orgId,id]); const current = rows[0]; if (!current) return null;
      const extra = kind === "contract" && action === "signed" ? ",signed_at=NOW(),evidence=$5" : kind === "contract" && action === "terminated" ? ",terminated_at=NOW(),termination_reason=$4" : kind === "matter" && ["closed","settled","cancelled"].includes(action) ? ",closed_at=NOW(),closure_reason=$4" : "";
      const updated = await client.query(`UPDATE ${config.table} SET status=$3,ct_mad_transaction_id=$6,correlation_id=$7${extra} WHERE organisation_id=$1 AND id=$2 RETURNING *`, [orgId,id,action,reason||null,evidence,transactionId,correlationId]);
      const event = await appendEvent(client, { organisationId: orgId, eventType: `${config.type}.${action}`, aggregateType: config.type.replace("legal.","legal_"), aggregateId: id, actorUserId, correlationId, payload: { reason: reason || null, evidenceCount: evidence.length } });
      return { record: updated.rows[0], event };
    }});
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

module.exports = { OBLIGATION_CREATE_POLICY, CONTRACT_TRANSITION_POLICY, POLICY_PUBLISH_POLICY, ACKNOWLEDGE_POLICY, ASSESS_POLICY, MATTER_TRANSITION_POLICY, validIdempotency, checksum, hasEvidence, validSource, createObligation, assessCompliance, transitionRecord };