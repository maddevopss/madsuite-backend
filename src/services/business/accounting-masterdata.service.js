const ACCOUNT_TYPES = new Set(["asset", "liability", "equity", "revenue", "expense"]);
const NORMAL_BALANCES = new Set(["debit", "credit"]);

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, statusCode: 400 });
}

function conflict(message) {
  return Object.assign(new Error(message), { status: 409, statusCode: 409 });
}

function normalizeCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{1,19}$/.test(code)) {
    throw badRequest("Le numéro de compte doit contenir de 2 à 20 caractères alphanumériques.");
  }
  return code;
}

function validateAccountInput(input = {}) {
  const code = normalizeCode(input.code);
  const name = String(input.name || "").trim();
  const accountType = String(input.accountType || "").trim();
  const normalBalance = String(input.normalBalance || "").trim();

  if (name.length < 2 || name.length > 120) throw badRequest("Le nom du compte doit contenir de 2 à 120 caractères.");
  if (!ACCOUNT_TYPES.has(accountType)) throw badRequest("Le type de compte est invalide.");
  if (!NORMAL_BALANCES.has(normalBalance)) throw badRequest("Le sens normal du compte est invalide.");

  const expectedBalance = ["asset", "expense"].includes(accountType) ? "debit" : "credit";
  if (normalBalance !== expectedBalance) {
    throw badRequest(`Un compte de type ${accountType} doit normalement être au ${expectedBalance}.`);
  }

  return {
    code,
    name,
    accountType,
    normalBalance,
    parentId: input.parentId ? Number(input.parentId) : null,
  };
}

async function createAccount(db, organisationId, input) {
  const account = validateAccountInput(input);
  if (account.parentId) {
    const parent = await db.query(
      "SELECT id, account_type FROM accounting_accounts WHERE organisation_id=$1 AND id=$2 AND is_active=TRUE",
      [organisationId, account.parentId],
    );
    if (!parent.rowCount) throw badRequest("Le compte parent est introuvable.");
    if (parent.rows[0].account_type !== account.accountType) throw badRequest("Le compte parent doit appartenir à la même famille comptable.");
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO accounting_accounts
       (organisation_id, code, name, account_type, normal_balance, parent_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [organisationId, account.code, account.name, account.accountType, account.normalBalance, account.parentId],
    );
    return rows[0];
  } catch (error) {
    if (error?.code === "23505") throw conflict("Ce numéro de compte existe déjà dans cette organisation.");
    throw error;
  }
}

function validatePeriodInput(input = {}) {
  const fiscalYear = Number(input.fiscalYear);
  const periodNumber = Number(input.periodNumber);
  const startsOn = String(input.startsOn || "");
  const endsOn = String(input.endsOn || "");

  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2200) throw badRequest("L’année financière est invalide.");
  if (!Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > 13) throw badRequest("Le numéro de période doit être compris entre 1 et 13.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw badRequest("Les dates de la période sont invalides.");
  if (startsOn > endsOn) throw badRequest("La date de début doit précéder la date de fin.");

  return { fiscalYear, periodNumber, startsOn, endsOn };
}

async function createPeriod(db, organisationId, input) {
  const period = validatePeriodInput(input);
  const overlap = await db.query(
    `SELECT id FROM accounting_periods
     WHERE organisation_id=$1 AND NOT (ends_on < $2::date OR starts_on > $3::date)
     LIMIT 1`,
    [organisationId, period.startsOn, period.endsOn],
  );
  if (overlap.rowCount) throw conflict("Cette période chevauche une période comptable existante.");

  try {
    const { rows } = await db.query(
      `INSERT INTO accounting_periods
       (organisation_id, fiscal_year, period_number, starts_on, ends_on)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [organisationId, period.fiscalYear, period.periodNumber, period.startsOn, period.endsOn],
    );
    return rows[0];
  } catch (error) {
    if (error?.code === "23505") throw conflict("Cette période existe déjà.");
    throw error;
  }
}

async function getEntryDetail(db, organisationId, entryId) {
  const entryResult = await db.query(
    `SELECT e.*, j.code AS journal_code, j.name AS journal_name,
            p.fiscal_year, p.period_number, p.status AS period_status
     FROM accounting_entries e
     JOIN accounting_journals j ON j.id=e.journal_id AND j.organisation_id=e.organisation_id
     LEFT JOIN accounting_periods p ON p.id=e.period_id AND p.organisation_id=e.organisation_id
     WHERE e.organisation_id=$1 AND e.id=$2`,
    [organisationId, entryId],
  );
  if (!entryResult.rowCount) return null;

  const linesResult = await db.query(
    `SELECT l.id, l.description, l.debit::numeric, l.credit::numeric,
            a.id AS account_id, a.code AS account_code, a.name AS account_name, a.account_type
     FROM accounting_entry_lines l
     JOIN accounting_accounts a ON a.id=l.account_id AND a.organisation_id=l.organisation_id
     WHERE l.organisation_id=$1 AND l.entry_id=$2
     ORDER BY l.id`,
    [organisationId, entryId],
  );

  const totals = linesResult.rows.reduce((acc, line) => {
    acc.debit += Number(line.debit || 0);
    acc.credit += Number(line.credit || 0);
    return acc;
  }, { debit: 0, credit: 0 });

  return {
    entry: entryResult.rows[0],
    lines: linesResult.rows,
    totals: {
      debit: Number(totals.debit.toFixed(2)),
      credit: Number(totals.credit.toFixed(2)),
      balanced: Number(totals.debit.toFixed(2)) === Number(totals.credit.toFixed(2)),
    },
  };
}

module.exports = {
  ACCOUNT_TYPES,
  NORMAL_BALANCES,
  normalizeCode,
  validateAccountInput,
  validatePeriodInput,
  createAccount,
  createPeriod,
  getEntryDetail,
};
