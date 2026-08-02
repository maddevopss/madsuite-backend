const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment } = require("./trust-persistence.service");
const { assessOffboardingReadiness } = require("./hr-complete-block.service");

const OFFBOARDING_OPEN_POLICY = "hr.offboarding.open@1";
const OFFBOARDING_CLOSE_POLICY = "hr.offboarding.close@1";
const OFFBOARDING_CANCEL_POLICY = "hr.offboarding.cancel@1";

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("hr.offboarding.open", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  if (!input?.employeeId || !input?.effectiveDate || !String(input?.reasonCode || "").trim()) {
    return { allowed: false, statusCode: 400, reason: "Employé, date d’effet et motif sont requis." };
  }
  return { allowed: true };
});

registerPolicy("hr.offboarding.close", "1", ({ input, idempotencyKey }) => {
  if (!input?.caseId || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Dossier et clé d’idempotence sont requis." };
  return { allowed: true };
});

registerPolicy("hr.offboarding.cancel", "1", ({ input, idempotencyKey }) => {
  if (!input?.caseId || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Dossier et clé d’idempotence sont requis." };
  if (!String(input.reason || "").trim()) return { allowed: false, statusCode: 400, reason: "Une raison est obligatoire pour annuler un dossier de départ." };
  return { allowed: true };
});

async function openOffboardingCase({ organisationId, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.offboarding.open",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [OFFBOARDING_OPEN_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM hr_offboarding_cases WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) return { duplicate: true, offboardingCase: duplicate.rows[0] };

      const employee = await client.query("SELECT id FROM hr_employees WHERE organisation_id=$1 AND id=$2", [orgId, input.employeeId]);
      if (!employee.rows[0]) throw Object.assign(new Error("Employé introuvable."), { statusCode: 404 });

      const existing = await client.query(
        "SELECT id FROM hr_offboarding_cases WHERE organisation_id=$1 AND employee_id=$2 AND effective_date=$3",
        [orgId, input.employeeId, input.effectiveDate],
      );
      if (existing.rows[0]) throw Object.assign(new Error("Un dossier de départ existe déjà pour cet employé à cette date d’effet."), { statusCode: 409 });

      const inserted = await client.query(
        `INSERT INTO hr_offboarding_cases (organisation_id,employee_id,effective_date,reason_code,checklist,created_by,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [orgId, input.employeeId, input.effectiveDate, input.reasonCode, JSON.stringify(input.checklist || []), actorUserId || null, idempotencyKey],
      );
      const offboardingCase = inserted.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "hr.offboarding.opened",
        aggregateType: "hr_offboarding_case",
        aggregateId: offboardingCase.id,
        actorUserId,
        correlationId,
        payload: { employeeId: offboardingCase.employee_id, effectiveDate: offboardingCase.effective_date, reasonCode: offboardingCase.reason_code },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "hr.offboarding_linked_to_employee", passed: true, evidence: [{ employeeId: offboardingCase.employee_id }] }],
      });
      return { duplicate: false, offboardingCase, event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

// Mise à jour libre (checklist, biens en suspens, entrevue de départ, les 4
// indicateurs de préparation) : idempotente par nature -- appliquer deux
// fois le même état produit le même résultat, pas de duplication possible.
// Ne fait jamais progresser vers 'completed'/'cancelled' : ces transitions
// passent par leurs propres actions gardées ci-dessous.
async function updateOffboardingCase({ organisationId, caseId, input = {}, actorUserId, db }) {
  const current = await db.query("SELECT * FROM hr_offboarding_cases WHERE organisation_id=$1 AND id=$2", [organisationId, caseId]);
  const existing = current.rows[0];
  if (!existing) return null;
  if (["completed", "cancelled"].includes(existing.status)) {
    throw Object.assign(new Error("Un dossier de départ fermé ou annulé ne peut plus être modifié."), { statusCode: 409 });
  }

  const checklist = input.checklist !== undefined ? input.checklist : existing.checklist;
  const outstandingItems = input.outstandingItems !== undefined ? input.outstandingItems : existing.outstanding_items;
  const exitInterview = input.exitInterview !== undefined ? input.exitInterview : existing.exit_interview;
  const payrollConfirmed = input.payrollConfirmed !== undefined ? Boolean(input.payrollConfirmed) : existing.payroll_confirmed;
  const accessRevoked = input.accessRevoked !== undefined ? Boolean(input.accessRevoked) : existing.access_revoked;
  const propertyReturned = input.propertyReturned !== undefined ? Boolean(input.propertyReturned) : existing.property_returned;
  const documentsCompleted = input.documentsCompleted !== undefined ? Boolean(input.documentsCompleted) : existing.documents_completed;
  const anyProgress = [payrollConfirmed, accessRevoked, propertyReturned, documentsCompleted].some(Boolean) || (Array.isArray(checklist) && checklist.length > 0);
  const status = existing.status === "open" && anyProgress ? "in_progress" : existing.status;

  const { rows } = await db.query(
    `UPDATE hr_offboarding_cases SET
       status=$1, checklist=$2, outstanding_items=$3, exit_interview=$4,
       payroll_confirmed=$5, access_revoked=$6, property_returned=$7, documents_completed=$8
     WHERE organisation_id=$9 AND id=$10 RETURNING *`,
    [status, JSON.stringify(checklist || []), JSON.stringify(outstandingItems || []), JSON.stringify(exitInterview || {}), payrollConfirmed, accessRevoked, propertyReturned, documentsCompleted, organisationId, caseId],
  );
  return { offboardingCase: rows[0] };
}

async function closeOffboardingCase({ organisationId, caseId, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.offboarding.close",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [OFFBOARDING_CLOSE_POLICY],
    input: { caseId },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const locked = await client.query("SELECT * FROM hr_offboarding_cases WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [orgId, caseId]);
      const existing = locked.rows[0];
      if (!existing) return null;
      if (existing.status === "completed") return { offboardingCase: existing, alreadyCompleted: true };
      if (existing.status === "cancelled") throw Object.assign(new Error("Un dossier de départ annulé ne peut pas être fermé."), { statusCode: 409 });

      const readiness = assessOffboardingReadiness({
        payrollConfirmed: existing.payroll_confirmed,
        accessRevoked: existing.access_revoked,
        propertyReturned: existing.property_returned,
        documentsCompleted: existing.documents_completed,
      });
      if (!readiness.ready) {
        throw Object.assign(
          new Error(`Le dossier ne peut pas être fermé : confirmations manquantes (${readiness.blockers.join(", ")}).`),
          { statusCode: 409 },
        );
      }

      const updated = await client.query(
        "UPDATE hr_offboarding_cases SET status='completed', completed_at=NOW() WHERE organisation_id=$1 AND id=$2 RETURNING *",
        [orgId, caseId],
      );
      const offboardingCase = updated.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "hr.offboarding.completed",
        aggregateType: "hr_offboarding_case",
        aggregateId: caseId,
        actorUserId,
        correlationId,
        payload: { employeeId: offboardingCase.employee_id },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "hr.offboarding_readiness_confirmed", passed: true, evidence: [readiness] }],
      });
      return { offboardingCase, event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function cancelOffboardingCase({ organisationId, caseId, reason, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.offboarding.cancel",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [OFFBOARDING_CANCEL_POLICY],
    input: { caseId, reason },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const updated = await client.query(
        "UPDATE hr_offboarding_cases SET status='cancelled' WHERE organisation_id=$1 AND id=$2 AND status IN ('open','in_progress') RETURNING *",
        [orgId, caseId],
      );
      if (updated.rows[0]) {
        const event = await appendEvent(client, {
          organisationId: orgId,
          eventType: "hr.offboarding.cancelled",
          aggregateType: "hr_offboarding_case",
          aggregateId: caseId,
          actorUserId,
          correlationId,
          payload: { reason },
        });
        const trust = await persistTrustAssessment(client, { organisationId: orgId, transactionId, correlationId, checks: [{ code: "hr.offboarding_cancel_reasoned", passed: true, evidence: [{ reason }] }] });
        return { offboardingCase: updated.rows[0], event, trust };
      }
      const existing = await client.query("SELECT id, status FROM hr_offboarding_cases WHERE organisation_id=$1 AND id=$2", [orgId, caseId]);
      if (!existing.rows[0]) return null;
      throw Object.assign(new Error("Seul un dossier ouvert ou en cours peut être annulé."), { statusCode: 409 });
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

module.exports = {
  OFFBOARDING_OPEN_POLICY,
  OFFBOARDING_CLOSE_POLICY,
  OFFBOARDING_CANCEL_POLICY,
  openOffboardingCase,
  updateOffboardingCase,
  closeOffboardingCase,
  cancelOffboardingCase,
};
