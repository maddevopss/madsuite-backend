const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment } = require("./trust-persistence.service");
const { assessInspectionClosure } = require("./sst-complete-block.service");

const INSPECTION_CLOSE_POLICY = "sst.inspection.close@1";
const INSPECTION_APPROVE_CLOSURE_POLICY = "sst.inspection.approve_closure@1";

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("sst.inspection.close", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  if (!input?.inspectionId) return { allowed: false, statusCode: 400, reason: "Une inspection est requise." };
  return { allowed: true };
});

registerPolicy("sst.inspection.approve_closure", "1", ({ input, idempotencyKey }) => {
  if (!input?.inspectionId || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Inspection et clé d’idempotence sont requises." };
  return { allowed: true };
});

async function closeInspection({ organisationId, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "sst.inspection.close",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [INSPECTION_CLOSE_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM sst_inspection_closures WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) return { duplicate: true, closure: duplicate.rows[0] };

      const inspection = await client.query("SELECT * FROM sst_inspections WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [orgId, input.inspectionId]);
      if (!inspection.rows[0]) throw Object.assign(new Error("Inspection introuvable."), { statusCode: 404 });
      if (inspection.rows[0].status === "completed") throw Object.assign(new Error("Cette inspection est déjà fermée."), { statusCode: 409 });
      if (inspection.rows[0].status === "cancelled") throw Object.assign(new Error("Une inspection annulée ne peut pas être fermée."), { statusCode: 409 });

      const existingClosure = await client.query("SELECT id FROM sst_inspection_closures WHERE organisation_id=$1 AND inspection_id=$2", [orgId, input.inspectionId]);
      if (existingClosure.rows[0]) throw Object.assign(new Error("Cette inspection a déjà une fermeture enregistrée."), { statusCode: 409 });

      const findings = Array.isArray(input.findings) ? input.findings : [];
      const criticalActionIds = findings
        .filter((f) => f?.severity === "critical" && f?.correctiveActionId)
        .map((f) => Number(f.correctiveActionId))
        .filter((id) => Number.isInteger(id));

      let validActionIds = new Set();
      if (criticalActionIds.length) {
        const existing = await client.query("SELECT id FROM sst_corrective_actions WHERE organisation_id=$1 AND id = ANY($2::bigint[])", [orgId, criticalActionIds]);
        validActionIds = new Set(existing.rows.map((row) => Number(row.id)));
      }
      // Un constat critique dont le correctiveActionId fourni par le client
      // ne correspond à aucune action corrective réelle en base est traité
      // comme non pourvu : on ne fait pas confiance à l'identifiant sans le
      // vérifier avant de l'utiliser comme preuve de fermeture.
      const verifiedFindings = findings.map((finding) => (
        finding?.severity === "critical" && finding?.correctiveActionId && !validActionIds.has(Number(finding.correctiveActionId))
          ? { ...finding, correctiveActionId: null }
          : finding
      ));

      const closure = assessInspectionClosure({ completedChecklist: input.completedChecklist, findings: verifiedFindings });
      if (!closure.complete) {
        throw Object.assign(
          new Error(`La fermeture exige une checklist complétée et aucun constat critique sans action corrective valide (${closure.openCriticalCount} en attente).`),
          { statusCode: 409 },
        );
      }

      const inserted = await client.query(
        `INSERT INTO sst_inspection_closures (organisation_id,inspection_id,completed_checklist,findings,corrective_action_ids,result,completed_by,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          orgId,
          input.inspectionId,
          JSON.stringify(input.completedChecklist || []),
          JSON.stringify(verifiedFindings),
          JSON.stringify([...validActionIds]),
          closure.result,
          actorUserId || null,
          idempotencyKey,
        ],
      );
      await client.query(
        `UPDATE sst_inspections SET status='completed', result=$1, findings=$2, checklist=$3, completed_at=NOW(), updated_at=NOW() WHERE organisation_id=$4 AND id=$5`,
        [closure.result, JSON.stringify(verifiedFindings), JSON.stringify(input.completedChecklist || []), orgId, input.inspectionId],
      );
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "sst.inspection.closed",
        aggregateType: "sst_inspection",
        aggregateId: input.inspectionId,
        actorUserId,
        correlationId,
        payload: { result: closure.result, findingsCount: verifiedFindings.length },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "sst.inspection_closure_gated", passed: true, evidence: [{ result: closure.result }] }],
      });
      return { duplicate: false, closure: inserted.rows[0], event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

// Sign-off distinct de la fermeture elle-même : un second regard (ex.
// responsable SST) qui contresigne une fermeture déjà enregistrée. Geste
// ponctuel (pas un cycle multi-étapes) : gardé par approved_by IS NULL,
// pas par une table d'historique dédiée.
async function approveInspectionClosure({ organisationId, inspectionId, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "sst.inspection.approve_closure",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [INSPECTION_APPROVE_CLOSURE_POLICY],
    input: { inspectionId },
    execute: async ({ client, organisationId: orgId, actorUserId }) => {
      const updated = await client.query(
        `UPDATE sst_inspection_closures SET approved_by=$1, approved_at=NOW()
         WHERE organisation_id=$2 AND inspection_id=$3 AND approved_by IS NULL RETURNING *`,
        [actorUserId || null, orgId, inspectionId],
      );
      if (updated.rows[0]) return { closure: updated.rows[0] };

      const existing = await client.query("SELECT * FROM sst_inspection_closures WHERE organisation_id=$1 AND inspection_id=$2", [orgId, inspectionId]);
      if (!existing.rows[0]) return null;
      throw Object.assign(new Error("Cette fermeture d’inspection est déjà contresignée."), { statusCode: 409 });
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

module.exports = {
  INSPECTION_CLOSE_POLICY,
  INSPECTION_APPROVE_CLOSURE_POLICY,
  closeInspection,
  approveInspectionClosure,
};
