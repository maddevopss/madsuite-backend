const ACCOUNT_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);
const NORMAL_BALANCE_BY_TYPE = Object.freeze({ asset: 'debit', expense: 'debit', liability: 'credit', equity: 'credit', revenue: 'credit' });

function normalizeAccount(input) {
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  const accountType = String(input.accountType || '').trim().toLowerCase();
  if (!code || !name) throw new Error('ACCOUNT_CODE_AND_NAME_REQUIRED');
  if (!ACCOUNT_TYPES.has(accountType)) throw new Error('ACCOUNT_TYPE_INVALID');
  return {
    code,
    name,
    accountType,
    normalBalance: input.normalBalance || NORMAL_BALANCE_BY_TYPE[accountType],
    parentId: input.parentId || null,
    systemKey: input.systemKey || null,
    isActive: input.isActive !== false,
  };
}

async function createAccount(client, organisationId, input) {
  const account = normalizeAccount(input);
  const { rows } = await client.query(
    `INSERT INTO accounting_accounts
      (organisation_id, code, name, account_type, normal_balance, parent_id, system_key, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [organisationId, account.code, account.name, account.accountType, account.normalBalance, account.parentId, account.systemKey, account.isActive],
  );
  return rows[0];
}

async function listAccounts(client, organisationId, { activeOnly = true } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM accounting_accounts
     WHERE organisation_id = $1 AND ($2::boolean = false OR is_active = true)
     ORDER BY code`,
    [organisationId, activeOnly],
  );
  return rows;
}

module.exports = { ACCOUNT_TYPES, NORMAL_BALANCE_BY_TYPE, normalizeAccount, createAccount, listAccounts };
