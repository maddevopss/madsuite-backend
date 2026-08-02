const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment } = require("./trust-persistence.service");
const { buildPolicyAcknowledgement } = require("./hr-complete-block.service");

const POLICY_ASSIGN_POLICY = "hr.policy_acknowledgement.assign@1";
const POLICY_DECIDE_POLICY = "hr.policy_acknowledgement.decide@1";

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("hr.policy_acknowledgement.assign", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  if (!input?.employeeId) return { allowed: false, statusCode: 400, reason: "Un employé est requis." };
  return { allowed: true };
});

registerPolicy("hr.policy_acknowledgement.decide", "1", ({ input, idempotencyKey }) => {
  if (!input?.acknowledgementId || !["acknowledge", "decline"].includes(input?.action) || !validIdempotency(idempotencyKey)) {
    return { allowed: false, statusCode: 400, reason: "Accusé de réception, décision et clé d’idempotence sont requis." };
  }
  if (input.action === "decline" && !String(input.reason || "").trim()) return { allowed: false, statusCode: 400, reason: "Une raison est obligatoire pour refuser une politique." };
  return { allowed: true };
});

// Assigner une nouvelle version d'une politique à un employé invalide
// automatiquement toute demande encore pending/acknowledged pour une
// version antérieure de la même politique -- l'employé doit re-signer la
// nouvelle version, jamais réputé conforme sur la base d'une ancienne.
async function assignPolicyAcknowledgement({ organisationId, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.policy_acknowledgement.assign",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [POLICY_ASSIGN_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM hr_policy_acknowledgements WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) return { duplicate: true, acknowledgement: duplicate.rows[0] };

      const employee = await client.query("SELECT id FROM hr_employees WHERE organisation_id=$1 AND id=$2", [orgId, input.employeeId]);
      if (!employee.rows[0]) throw Object.assign(new Error("Employé introuvable."), { statusCode: 404 });

      const policy = buildPolicyAcknowledgement(input);

      const invalidated = await client.query(
        `UPDATE hr_policy_acknowledgements SET status='expired'
         WHERE organisation_id=$1 AND employee_id=$2 AND policy_code=$3 AND policy_version<>$4 AND status IN ('pending','acknowledged')
         RETURNING id`,
        [orgId, input.employeeId, policy.policyCode, policy.policyVersion],
      );

      const inserted = await client.query(
        `INSERT INTO hr_policy_acknowledgements (organisation_id,employee_id,policy_code,policy_version,document_id,due_at,evidence,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (organisation_id,employee_id,policy_code,policy_version) DO UPDATE SET due_at=EXCLUDED.due_at
         RETURNING *`,
        [orgId, input.employeeId, policy.policyCode, policy.policyVersion, policy.documentId, policy.dueAt, JSON.stringify(policy.evidence), idempotencyKey],
      );
      const acknowledgement = inserted.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "hr.policy_acknowledgement.assigned",
        aggregateType: "hr_policy_acknowledgement",
        aggregateId: acknowledgement.id,
        actorUserId,
        correlationId,
        payload: { employeeId: input.employeeId, policyCode: policy.policyCode, policyVersion: policy.policyVersion, invalidatedCount: invalidated.rows.length },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "hr.policy_previous_versions_invalidated", passed: true, evidence: [{ invalidatedCount: invalidated.rows.length }] }],
      });
      return { duplicate: false, acknowledgement, invalidatedCount: invalidated.rows.length, event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

// acknowledge/decline sont des gestes ponctuels sur une demande 'pending' :
// gardés par le statut lui-même (WHERE status='pending'), pas par une table
// d'historique dédiée. La traçabilité (IP, horodatage) est capturée
// côté serveur -- jamais fournie telle quelle par le client -- et ajoutée
// à evidence en plus de toute preuve que le client fournit (ex. case à
// cocher, signature).
async function decidePolicyAcknowledgement({ organisationId, acknowledgementId, action, input = {}, requestIp, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.policy_acknowledgement.decide",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [POLICY_DECIDE_POLICY],
    input: { ...input, acknowledgementId, action },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const locked = await client.query("SELECT * FROM hr_policy_acknowledgements WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [orgId, acknowledgementId]);
      const acknowledgement = locked.rows[0];
      if (!acknowledgement) return null;
      if (acknowledgement.status !== "pending") {
        throw Object.assign(new Error("Seule une demande en attente peut être décidée."), { statusCode: 409 });
      }

      const status = action === "acknowledge" ? "acknowledged" : "declined";
      const serverEvidence = {
        method: action,
        ip: requestIp || null,
        userAgent: input.userAgent || null,
        decidedAt: new Date().toISOString(),
        decidedBy: actorUserId || null,
        clientEvidence: input.evidence || null,
      };
      const evidence = [...(Array.isArray(acknowledgement.evidence) ? acknowledgement.evidence : []), serverEvidence];

      const updated = await client.query(
        `UPDATE hr_policy_acknowledgements SET status=$1, acknowledged_at=CASE WHEN $2 THEN NOW() ELSE acknowledged_at END, evidence=$3
         WHERE organisation_id=$4 AND id=$5 RETURNING *`,
        [status, action === "acknowledge", JSON.stringify(evidence), orgId, acknowledgementId],
      );
      const next = updated.rows[0];

      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: `hr.policy_acknowledgement.${status}`,
        aggregateType: "hr_policy_acknowledgement",
        aggregateId: acknowledgementId,
        actorUserId,
        correlationId,
        payload: { policyCode: acknowledgement.policy_code, policyVersion: acknowledgement.policy_version, reason: input.reason || null, ip: requestIp || null },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [
          { code: "hr.policy_decision_recorded", passed: next.status === status, evidence: [{ status }] },
          { code: "hr.policy_traceability_captured", passed: Boolean(requestIp), evidence: [{ ip: requestIp || null }] },
        ],
      });
      return { acknowledgement: next, event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

module.exports = {
  POLICY_ASSIGN_POLICY,
  POLICY_DECIDE_POLICY,
  assignPolicyAcknowledgement,
  decidePolicyAcknowledgement,
};
