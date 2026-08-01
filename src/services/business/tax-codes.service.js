function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function notFound(message) {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function toMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const TAX_TYPES = new Set(["collected", "recoverable"]);

function validateTaxCodeInput(input = {}) {
  const code = String(input.code || "").trim().toUpperCase();
  const name = String(input.name || "").trim();
  const rate = Number(input.rate);
  const taxType = String(input.taxType || "").trim();

  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) throw badRequest("Le code de taxe doit contenir de 2 à 32 caractères alphanumériques.");
  if (name.length < 2 || name.length > 120) throw badRequest("Le nom du profil de taxe doit contenir de 2 à 120 caractères.");
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) throw badRequest("Le taux doit être un nombre entre 0 et 1 (ex. 0.05 pour 5%).");
  if (!TAX_TYPES.has(taxType)) throw badRequest("Le type de taxe doit être 'collected' ou 'recoverable'.");
  if (!input.accountId) throw badRequest("Le compte comptable associé est obligatoire.");
  if (!input.effectiveFrom) throw badRequest("La date d'entrée en vigueur est obligatoire.");

  return { code, name, rate, taxType, accountId: input.accountId, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo || null };
}

async function createTaxCode(db, organisationId, input) {
  const taxCode = validateTaxCodeInput(input);

  const account = await db.query(
    `SELECT id FROM accounting_accounts WHERE organisation_id=$1 AND id=$2 AND is_active=TRUE`,
    [organisationId, taxCode.accountId],
  );
  if (!account.rowCount) throw badRequest("Le compte comptable associé est introuvable ou inactif.");

  try {
    const { rows } = await db.query(
      `INSERT INTO tax_codes (organisation_id, code, name, rate, tax_type, account_id, effective_from, effective_to, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)
       RETURNING *`,
      [organisationId, taxCode.code, taxCode.name, taxCode.rate, taxCode.taxType, taxCode.accountId, taxCode.effectiveFrom, taxCode.effectiveTo, input.createdBy || null],
    );
    return rows[0];
  } catch (error) {
    if (error?.code === "23505") throw conflict("Un profil de taxe existe déjà pour ce code à cette date d'entrée en vigueur.");
    throw error;
  }
}

async function listTaxCodes(db, organisationId) {
  const { rows } = await db.query(
    `SELECT * FROM tax_codes WHERE organisation_id=$1 ORDER BY code, effective_from DESC`,
    [organisationId],
  );
  return rows;
}

// Un seul profil actif par code à la fois (même discipline que
// payroll_rulesets/activateRuleset) : l'activation retire l'ancien profil
// actif du même code en fixant sa date de fin, juste avant la date d'entrée
// en vigueur du nouveau — jamais deux profils actifs se chevauchant pour un
// même code.
async function activateTaxCode(db, organisationId, taxCodeId, activatedBy) {
  const current = await db.query(
    `SELECT * FROM tax_codes WHERE organisation_id=$1 AND id=$2 FOR UPDATE`,
    [organisationId, taxCodeId],
  );
  const taxCode = current.rows[0];
  if (!taxCode) throw notFound("Profil de taxe introuvable.");
  if (taxCode.status === "active") return taxCode;

  await db.query(
    `UPDATE tax_codes
       SET status='retired', effective_to=COALESCE(effective_to, $4::date - INTERVAL '1 day')
     WHERE organisation_id=$1 AND code=$2 AND status='active' AND id<>$3`,
    [organisationId, taxCode.code, taxCodeId, taxCode.effective_from],
  );

  const activated = await db.query(
    `UPDATE tax_codes SET status='active', activated_at=NOW(), activated_by=$3 WHERE organisation_id=$1 AND id=$2 RETURNING *`,
    [organisationId, taxCodeId, activatedBy || null],
  );
  return activated.rows[0];
}

// Résout le profil de taxe réellement applicable pour un code donné à une
// date donnée (date de facture/dépense), jamais "le plus récent" — même
// principe que la sélection du jeu de règles de paie par date de paie.
async function resolveActiveTaxCode(db, organisationId, code, asOfDate) {
  const { rows } = await db.query(
    `SELECT * FROM tax_codes
     WHERE organisation_id=$1 AND code=$2 AND status='active'
       AND effective_from <= $3::date
       AND (effective_to IS NULL OR effective_to >= $3::date)
     ORDER BY effective_from DESC
     LIMIT 1`,
    [organisationId, String(code || "").trim().toUpperCase(), asOfDate],
  );
  return rows[0] || null;
}

// Calcul déterministe et explicable : le montant de taxe et son détail de
// calcul (taux appliqué, profil utilisé) plutôt qu'un simple nombre opaque.
function calculateTax(subtotal, taxCode) {
  const base = toMoney(subtotal);
  if (!taxCode) return { amount: 0, rate: 0, taxCodeId: null, code: null };
  const amount = toMoney(base * Number(taxCode.rate));
  return { amount, rate: Number(taxCode.rate), taxCodeId: taxCode.id, code: taxCode.code };
}

module.exports = {
  createTaxCode,
  listTaxCodes,
  activateTaxCode,
  resolveActiveTaxCode,
  calculateTax,
};
