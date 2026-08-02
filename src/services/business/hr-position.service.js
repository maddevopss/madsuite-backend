const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment } = require("./trust-persistence.service");

const POSITION_CREATE_POLICY = "hr.position.create@1";

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

registerPolicy("hr.position.create", "1", ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, reason: "Une clé d’idempotence valide est obligatoire." };
  if (!String(input?.code || "").trim() || !String(input?.title || "").trim()) return { allowed: false, statusCode: 400, reason: "Le code et le titre du poste sont requis." };
  return { allowed: true };
});

async function createPosition({ organisationId, input = {}, idempotencyKey, createdBy }) {
  const tx = await executeTransaction({
    type: "hr.position.create",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    idempotencyKey,
    policies: [POSITION_CREATE_POLICY],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const duplicate = await client.query("SELECT * FROM hr_positions WHERE organisation_id=$1 AND idempotency_key=$2", [orgId, idempotencyKey]);
      if (duplicate.rows[0]) return { duplicate: true, position: duplicate.rows[0] };

      const inserted = await client.query(
        `INSERT INTO hr_positions (organisation_id,code,title,description,created_by,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [orgId, String(input.code).trim(), String(input.title).trim(), input.description || null, actorUserId || null, idempotencyKey],
      );
      const position = inserted.rows[0];
      const event = await appendEvent(client, {
        organisationId: orgId,
        eventType: "hr.position.created",
        aggregateType: "hr_position",
        aggregateId: position.id,
        actorUserId,
        correlationId,
        payload: { code: position.code, title: position.title },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId,
        transactionId,
        correlationId,
        checks: [{ code: "hr.position_identity_present", passed: true, evidence: [{ code: position.code }] }],
      });
      return { duplicate: false, position, event, trust };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

async function updatePosition({ organisationId, positionId, input = {}, db }) {
  const current = await db.query("SELECT * FROM hr_positions WHERE organisation_id=$1 AND id=$2", [organisationId, positionId]);
  if (!current.rows[0]) return null;
  const existing = current.rows[0];

  const title = input.title !== undefined ? String(input.title).trim() : existing.title;
  const description = input.description !== undefined ? input.description : existing.description;
  const isActive = input.isActive !== undefined ? Boolean(input.isActive) : existing.is_active;

  const { rows } = await db.query(
    `UPDATE hr_positions SET title=$1, description=$2, is_active=$3, updated_at=NOW()
     WHERE organisation_id=$4 AND id=$5 RETURNING *`,
    [title, description, isActive, organisationId, positionId],
  );
  return { position: rows[0] };
}

// Remplace l'ensemble des compétences requises d'un poste par la liste
// fournie (pas d'ajout/retrait incrémental) : plus simple et sans
// ambiguïté pour représenter "voici la matrice actuelle de ce poste".
async function setPositionRequiredCompetencies({ organisationId, positionId, competencyIds = [], db }) {
  const position = await db.query("SELECT id FROM hr_positions WHERE organisation_id=$1 AND id=$2", [organisationId, positionId]);
  if (!position.rows[0]) return null;

  const uniqueIds = [...new Set(competencyIds.map((id) => Number(id)).filter((id) => Number.isInteger(id)))];
  if (uniqueIds.length) {
    const existing = await db.query("SELECT id FROM hr_competencies WHERE organisation_id=$1 AND id = ANY($2::bigint[])", [organisationId, uniqueIds]);
    const validIds = new Set(existing.rows.map((row) => Number(row.id)));
    const invalid = uniqueIds.filter((id) => !validIds.has(id));
    if (invalid.length) throw Object.assign(new Error(`Compétence(s) introuvable(s) : ${invalid.join(", ")}.`), { statusCode: 404 });
  }

  await db.query("DELETE FROM hr_position_competencies WHERE organisation_id=$1 AND position_id=$2", [organisationId, positionId]);
  for (const competencyId of uniqueIds) {
    await db.query(
      "INSERT INTO hr_position_competencies (organisation_id,position_id,competency_id,is_required) VALUES ($1,$2,$3,TRUE)",
      [organisationId, positionId, competencyId],
    );
  }
  const { rows } = await db.query(
    `SELECT pc.*, c.code, c.name FROM hr_position_competencies pc JOIN hr_competencies c ON c.id=pc.competency_id
     WHERE pc.organisation_id=$1 AND pc.position_id=$2 ORDER BY c.name`,
    [organisationId, positionId],
  );
  return { requiredCompetencies: rows };
}

async function assignEmployeePosition({ organisationId, employeeId, positionId, db }) {
  if (positionId) {
    const position = await db.query("SELECT id FROM hr_positions WHERE organisation_id=$1 AND id=$2", [organisationId, positionId]);
    if (!position.rows[0]) throw Object.assign(new Error("Poste introuvable."), { statusCode: 404 });
  }
  const { rows } = await db.query(
    "UPDATE hr_employees SET position_id=$1, updated_at=NOW() WHERE organisation_id=$2 AND id=$3 RETURNING *",
    [positionId || null, organisationId, employeeId],
  );
  if (!rows[0]) return null;
  return { employee: rows[0] };
}

// Compare les compétences valides et non expirées de l'employé aux
// compétences requises par son poste assigné -- la matrice de conformité
// par employé demandée dans le mandat (section E RH / C SST), généralisée
// au-delà des seules formations SST.
async function getEmployeeQualificationGaps({ organisationId, employeeId, db }) {
  const employee = await db.query("SELECT id, position_id FROM hr_employees WHERE organisation_id=$1 AND id=$2", [organisationId, employeeId]);
  if (!employee.rows[0]) return null;
  if (!employee.rows[0].position_id) return { positionId: null, required: [], held: [], missing: [] };

  const [required, held] = await Promise.all([
    db.query(
      `SELECT c.id, c.code, c.name FROM hr_position_competencies pc JOIN hr_competencies c ON c.id=pc.competency_id
       WHERE pc.organisation_id=$1 AND pc.position_id=$2 AND pc.is_required=TRUE`,
      [organisationId, employee.rows[0].position_id],
    ),
    db.query(
      `SELECT DISTINCT competency_id FROM hr_employee_competencies
       WHERE organisation_id=$1 AND employee_id=$2 AND status='valid' AND (expires_at IS NULL OR expires_at > NOW())`,
      [organisationId, employeeId],
    ),
  ]);
  const heldIds = new Set(held.rows.map((row) => Number(row.competency_id)));
  const missing = required.rows.filter((row) => !heldIds.has(Number(row.id)));
  return { positionId: employee.rows[0].position_id, required: required.rows, held: [...heldIds], missing };
}

module.exports = {
  POSITION_CREATE_POLICY,
  createPosition,
  updatePosition,
  setPositionRequiredCompetencies,
  assignEmployeePosition,
  getEmployeeQualificationGaps,
};
