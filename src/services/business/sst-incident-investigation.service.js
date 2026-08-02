const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment } = require("./trust-persistence.service");
const { transitionInvestigation, canCloseInvestigation } = require("./sst-complete-block.service");

const INVESTIGATION_OPEN_POLICY = "sst.investigation.open@1";
const INVESTIGATION_TRANSITION_POLICY = "sst.investigation.transition@1";

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("sst.investigation.open", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  if (!input?.incidentId) return { allowed: false, statusCode: 400, reason: "Un incident est requis." };
  return { allowed: true };
});

registerPolicy("sst.investigation.transition", "1", ({ input, idempotencyKey }) => {
  if (!input?.investigationId || !input?.action || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Enquête, action et clé d’idempotence sont requises." };
  return { allowed: true };
});

async function openInvestigation({ organisationId, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "sst.investigation.open",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [INVESTIGATION_OPEN_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM sst_incident_investigations WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) return { duplicate: true, investigation: duplicate.rows[0] };

      const incident = await client.query("SELECT id FROM sst_incidents WHERE organisation_id=$1 AND id=$2", [orgId, input.incidentId]);
      if (!incident.rows[0]) throw Object.assign(new Error("Incident introuvable."), { statusCode: 404 });

      const existing = await client.query("SELECT id FROM sst_incident_investigations WHERE organisation_id=$1 AND incident_id=$2", [orgId, input.incidentId]);
      if (existing.rows[0]) throw Object.assign(new Error("Cet incident a déjà une enquête ouverte."), { statusCode: 409 });

      const inserted = await client.query(
        `INSERT INTO sst_incident_investigations (organisation_id,incident_id,lead_user_id,idempotency_key)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [orgId, input.incidentId, input.leadUserId || actorUserId || null, idempotencyKey],
      );
      const investigation = inserted.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "sst.investigation.opened",
        aggregateType: "sst_incident_investigation",
        aggregateId: investigation.id,
        actorUserId,
        correlationId,
        payload: { incidentId: investigation.incident_id },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "sst.investigation_linked_to_incident", passed: true, evidence: [{ incidentId: investigation.incident_id }] }],
      });
      return { duplicate: false, investigation, event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

// Les champs d'enquête peuvent être complétés à n'importe quelle étape du
// cycle, pas seulement à l'ouverture — fusionnés avec la ligne existante
// avant d'évaluer transitionInvestigation()/canCloseInvestigation().
function mergeInvestigationFields(existing, input = {}) {
  return {
    immediateCauses: input.immediateCauses !== undefined ? input.immediateCauses : existing.immediate_causes,
    rootCauses: input.rootCauses !== undefined ? input.rootCauses : existing.root_causes,
    witnessStatements: input.witnessStatements !== undefined ? input.witnessStatements : existing.witness_statements,
    evidence: input.evidence !== undefined ? input.evidence : existing.evidence,
    findings: input.findings !== undefined ? input.findings : existing.findings,
  };
}

async function transitionInvestigationCase({ organisationId, investigationId, action, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "sst.investigation.transition",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [INVESTIGATION_TRANSITION_POLICY],
    input: { ...input, investigationId, action },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM sst_incident_investigation_transitions WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) {
        const investigation = await client.query("SELECT * FROM sst_incident_investigations WHERE organisation_id=$1 AND id=$2", [orgId, duplicate.rows[0].investigation_id]);
        return { duplicate: true, investigation: investigation.rows[0], transition: duplicate.rows[0] };
      }

      const locked = await client.query("SELECT * FROM sst_incident_investigations WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [orgId, investigationId]);
      const investigation = locked.rows[0];
      if (!investigation) return null;

      const newStatus = transitionInvestigation(investigation.status, action);
      const merged = mergeInvestigationFields(investigation, input);

      if (newStatus === "closed") {
        const correctiveActions = await client.query(
          "SELECT status FROM sst_corrective_actions WHERE organisation_id=$1 AND source_type='incident' AND source_id=$2",
          [orgId, investigation.incident_id],
        );
        const closure = canCloseInvestigation({ ...merged, correctiveActions: correctiveActions.rows });
        if (!closure.ready) {
          throw Object.assign(new Error(`La fermeture de l’enquête exige : ${closure.blockers.join(", ")}.`), { statusCode: 409 });
        }
      }

      const reviewedBy = newStatus === "review" ? actorUserId : investigation.reviewed_by;
      const reviewedAt = newStatus === "review" ? new Date().toISOString() : investigation.reviewed_at;
      const closedAt = newStatus === "closed" ? new Date().toISOString() : investigation.closed_at;

      const updated = await client.query(
        `UPDATE sst_incident_investigations SET
           status=$1, immediate_causes=$2, root_causes=$3, witness_statements=$4, evidence=$5,
           findings=$6, reviewed_by=$7, reviewed_at=$8, closed_at=$9
         WHERE organisation_id=$10 AND id=$11 RETURNING *`,
        [
          newStatus,
          JSON.stringify(merged.immediateCauses || []),
          JSON.stringify(merged.rootCauses || []),
          JSON.stringify(merged.witnessStatements || []),
          JSON.stringify(merged.evidence || []),
          merged.findings || null,
          reviewedBy || null,
          reviewedAt,
          closedAt,
          orgId,
          investigationId,
        ],
      );
      const next = updated.rows[0];

      const transition = await client.query(
        `INSERT INTO sst_incident_investigation_transitions (organisation_id,investigation_id,action,previous_status,new_status,actor_user_id,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [orgId, investigationId, action, investigation.status, newStatus, actorUserId || null, idempotencyKey],
      );

      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: `sst.investigation.${newStatus}`,
        aggregateType: "sst_incident_investigation",
        aggregateId: investigationId,
        actorUserId,
        correlationId,
        payload: { previousStatus: investigation.status, newStatus, action, incidentId: investigation.incident_id },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "sst.investigation_transition_recorded", passed: true, evidence: [{ transitionId: transition.rows[0].id, action }] }],
      });
      return { duplicate: false, investigation: next, transition: transition.rows[0], event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

module.exports = {
  INVESTIGATION_OPEN_POLICY,
  INVESTIGATION_TRANSITION_POLICY,
  openInvestigation,
  transitionInvestigationCase,
};
