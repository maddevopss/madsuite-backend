const crypto = require("crypto");

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

// JSONB ne préserve pas l'ordre des clés : un JSON.stringify direct sur l'objet
// tel que soumis puis sur l'objet relu depuis la base ne produit pas la même
// chaîne. Stringify canonique (clés triées, récursif) pour que le checksum
// survive à l'aller-retour PostgreSQL.
function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksumRules(rules) {
  return crypto.createHash("sha256").update(canonicalStringify(rules || {})).digest("hex");
}

function validateRulesetForActivation(ruleset) {
  if (!ruleset) throw badRequest("Jeu de règles introuvable.");
  if (!ruleset.version || !ruleset.province || !ruleset.effective_from) {
    throw badRequest("Le jeu de règles est incomplet.");
  }
  const expected = checksumRules(ruleset.rules);
  if (!ruleset.checksum || ruleset.checksum !== expected) {
    throw badRequest("L’empreinte du jeu de règles est invalide.");
  }
  // #363 : un jeu de règles ne peut gouverner un calcul de paie réel sans
  // référence vérifiable au texte légal/fiscal dont il découle.
  if (!ruleset.legal_source || !String(ruleset.legal_source).trim()) {
    throw badRequest("La source légale/fiscale du jeu de règles est obligatoire avant activation.");
  }
}

async function activateRuleset(db, organisationId, rulesetId, actorUserId) {
  const current = await db.query(
    `SELECT * FROM payroll_rulesets WHERE organisation_id=$1 AND id=$2 FOR UPDATE`,
    [organisationId, rulesetId],
  );
  const ruleset = current.rows[0];
  validateRulesetForActivation(ruleset);

  await db.query(
    `UPDATE payroll_rulesets
       SET status='retired', effective_to=COALESCE(effective_to, $4::date - INTERVAL '1 day')
     WHERE organisation_id=$1 AND province=$2 AND status='active' AND id<>$3`,
    [organisationId, ruleset.province, rulesetId, ruleset.effective_from],
  );

  const activated = await db.query(
    `UPDATE payroll_rulesets
       SET status='active', activated_at=NOW(), activated_by=$3
     WHERE organisation_id=$1 AND id=$2
     RETURNING *`,
    [organisationId, rulesetId, actorUserId || null],
  );
  return activated.rows[0];
}

async function createRunFromPeriod(db, { organisationId, periodId, idempotencyKey }) {
  if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
    throw badRequest("Une clé d’idempotence valide est obligatoire.");
  }

  const periodResult = await db.query(
    `SELECT * FROM payroll_periods WHERE organisation_id=$1 AND id=$2 FOR UPDATE`,
    [organisationId, periodId],
  );
  const period = periodResult.rows[0];
  if (!period) throw badRequest("Période de paie introuvable.");

  const duplicate = await db.query(
    `SELECT * FROM payroll_runs
      WHERE organisation_id=$1
        AND payroll_period_id=$2
        AND status<>'void'
      LIMIT 1`,
    [organisationId, periodId],
  );
  if (duplicate.rows[0]) {
    if (duplicate.rows[0].creation_idempotency_key === idempotencyKey) {
      return { duplicate: true, run: duplicate.rows[0] };
    }
    throw conflict("Cette période possède déjà un cycle de paie actif.");
  }

  const rulesetResult = await db.query(
    `SELECT * FROM payroll_rulesets
      WHERE organisation_id=$1
        AND province='QC'
        AND status='active'
        AND effective_from <= $2
        AND (effective_to IS NULL OR effective_to >= $2)
      ORDER BY effective_from DESC
      LIMIT 1`,
    [organisationId, period.pay_date],
  );
  const ruleset = rulesetResult.rows[0];
  if (!ruleset) throw conflict("Aucun jeu de règles actif ne couvre la date de paie.");

  const created = await db.query(
    `INSERT INTO payroll_runs
      (organisation_id,payroll_period_id,period_start,period_end,pay_date,ruleset_id,ruleset_version,creation_idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [organisationId, period.id, period.period_start, period.period_end, period.pay_date, ruleset.id, ruleset.version, idempotencyKey],
  );
  return { duplicate: false, run: created.rows[0] };
}

module.exports = { validateRulesetForActivation, activateRuleset, createRunFromPeriod, checksumRules };
