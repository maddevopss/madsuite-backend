const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment } = require("./trust-persistence.service");

const DEPARTMENT_CREATE_POLICY = "hr.department.create@1";
const DEPARTMENT_UPDATE_POLICY = "hr.department.update@1";

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("hr.department.create", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  if (!String(input?.code || "").trim() || !String(input?.name || "").trim()) return { allowed: false, statusCode: 400, reason: "Le code et le nom du département sont requis." };
  return { allowed: true };
});

registerPolicy("hr.department.update", "1", ({ input }) => {
  if (!input?.departmentId) return { allowed: false, statusCode: 400, reason: "Un département est requis." };
  return { allowed: true };
});

// Un département ne peut pas devenir son propre descendant : on remonte la
// chaîne des parents à partir du parent proposé et on refuse si le
// département visé (departmentId) apparaît dans cette chaîne.
async function assertNoCycle(client, organisationId, departmentId, proposedParentId) {
  if (!proposedParentId) return;
  if (Number(proposedParentId) === Number(departmentId)) {
    throw Object.assign(new Error("Un département ne peut pas être son propre parent."), { statusCode: 400 });
  }
  const { rows } = await client.query(
    `WITH RECURSIVE ancestry AS (
       SELECT id, parent_department_id FROM hr_departments WHERE organisation_id=$1 AND id=$2
       UNION ALL
       SELECT d.id, d.parent_department_id FROM hr_departments d
       JOIN ancestry a ON d.id = a.parent_department_id AND d.organisation_id=$1
     )
     SELECT id FROM ancestry WHERE id=$3`,
    [organisationId, proposedParentId, departmentId],
  );
  if (rows.length) throw Object.assign(new Error("Cette affectation créerait un cycle dans la hiérarchie des départements."), { statusCode: 409 });
}

async function createDepartment({ organisationId, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.department.create",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [DEPARTMENT_CREATE_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM hr_departments WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) return { duplicate: true, department: duplicate.rows[0] };

      if (input.parentDepartmentId) {
        const parent = await client.query("SELECT id FROM hr_departments WHERE organisation_id=$1 AND id=$2", [orgId, input.parentDepartmentId]);
        if (!parent.rows[0]) throw Object.assign(new Error("Département parent introuvable."), { statusCode: 404 });
      }
      if (input.managerEmployeeId) {
        const manager = await client.query("SELECT id FROM hr_employees WHERE organisation_id=$1 AND id=$2", [orgId, input.managerEmployeeId]);
        if (!manager.rows[0]) throw Object.assign(new Error("Gestionnaire introuvable."), { statusCode: 404 });
      }

      const inserted = await client.query(
        `INSERT INTO hr_departments (organisation_id,code,name,parent_department_id,manager_employee_id,created_by,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [orgId, String(input.code).trim(), String(input.name).trim(), input.parentDepartmentId || null, input.managerEmployeeId || null, actorUserId || null, idempotencyKey],
      );
      const department = inserted.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "hr.department.created",
        aggregateType: "hr_department",
        aggregateId: department.id,
        actorUserId,
        correlationId,
        payload: { code: department.code, name: department.name, parentDepartmentId: department.parent_department_id },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "hr.department_identity_present", passed: true, evidence: [{ code: department.code }] }],
      });
      return { duplicate: false, department, event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function updateDepartment({ organisationId, departmentId, input = {}, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.department.update",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey: `update:${departmentId}:${Date.now()}`,
    policies: [DEPARTMENT_UPDATE_POLICY],
    input: { ...input, departmentId },
    execute: async ({ client, organisationId: orgId }) => {
      const existing = await client.query("SELECT * FROM hr_departments WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [orgId, departmentId]);
      if (!existing.rows[0]) return null;
      const current = existing.rows[0];

      const name = input.name !== undefined ? String(input.name).trim() : current.name;
      const isActive = input.isActive !== undefined ? Boolean(input.isActive) : current.is_active;
      const managerEmployeeId = input.managerEmployeeId !== undefined ? input.managerEmployeeId : current.manager_employee_id;
      const parentDepartmentId = input.parentDepartmentId !== undefined ? input.parentDepartmentId : current.parent_department_id;

      if (parentDepartmentId !== current.parent_department_id) {
        await assertNoCycle(client, orgId, departmentId, parentDepartmentId);
        if (parentDepartmentId) {
          const parent = await client.query("SELECT id FROM hr_departments WHERE organisation_id=$1 AND id=$2", [orgId, parentDepartmentId]);
          if (!parent.rows[0]) throw Object.assign(new Error("Département parent introuvable."), { statusCode: 404 });
        }
      }
      if (managerEmployeeId && managerEmployeeId !== current.manager_employee_id) {
        const manager = await client.query("SELECT id FROM hr_employees WHERE organisation_id=$1 AND id=$2", [orgId, managerEmployeeId]);
        if (!manager.rows[0]) throw Object.assign(new Error("Gestionnaire introuvable."), { statusCode: 404 });
      }

      const { rows } = await client.query(
        `UPDATE hr_departments SET name=$1, is_active=$2, manager_employee_id=$3, parent_department_id=$4, updated_at=NOW()
         WHERE organisation_id=$5 AND id=$6 RETURNING *`,
        [name, isActive, managerEmployeeId || null, parentDepartmentId || null, orgId, departmentId],
      );
      return { department: rows[0] };
    },
  });
  return tx.result || null;
}

async function assignEmployeeDepartment({ organisationId, employeeId, departmentId, db }) {
  if (departmentId) {
    const department = await db.query("SELECT id FROM hr_departments WHERE organisation_id=$1 AND id=$2", [organisationId, departmentId]);
    if (!department.rows[0]) throw Object.assign(new Error("Département introuvable."), { statusCode: 404 });
  }
  const { rows } = await db.query(
    "UPDATE hr_employees SET department_id=$1, updated_at=NOW() WHERE organisation_id=$2 AND id=$3 RETURNING *",
    [departmentId || null, organisationId, employeeId],
  );
  if (!rows[0]) return null;
  return { employee: rows[0] };
}

async function getOrganisationChart({ organisationId, db }) {
  const [departments, employees] = await Promise.all([
    db.query("SELECT * FROM hr_departments WHERE organisation_id=$1 ORDER BY name", [organisationId]),
    db.query(
      `SELECT id, legal_name, job_title, department_id, manager_employee_id, employment_status
       FROM hr_employees WHERE organisation_id=$1 ORDER BY legal_name`,
      [organisationId],
    ),
  ]);
  return { departments: departments.rows, employees: employees.rows };
}

module.exports = {
  DEPARTMENT_CREATE_POLICY,
  DEPARTMENT_UPDATE_POLICY,
  createDepartment,
  updateDepartment,
  assignEmployeeDepartment,
  getOrganisationChart,
};
