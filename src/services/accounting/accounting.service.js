const db = require('../../../db');

const ACCOUNT_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);
const DEFAULT_CHART = [
  ['1000', 'Encaisse', 'asset', 'cash', 'debit', 'cash'],
  ['1100', 'Comptes clients', 'asset', 'receivable', 'debit', 'accounts_receivable'],
  ['1200', 'TPS à recevoir', 'asset', 'tax_receivable', 'debit', 'gst_receivable'],
  ['1210', 'TVQ à recevoir', 'asset', 'tax_receivable', 'debit', 'qst_receivable'],
  ['2000', 'Comptes fournisseurs', 'liability', 'payable', 'credit', 'accounts_payable'],
  ['2100', 'TPS à remettre', 'liability', 'tax_payable', 'credit', 'gst_payable'],
  ['2110', 'TVQ à remettre', 'liability', 'tax_payable', 'credit', 'qst_payable'],
  ['3000', 'Capital', 'equity', 'capital', 'credit', 'owners_equity'],
  ['4000', 'Revenus de services', 'revenue', 'services', 'credit', 'service_revenue'],
  ['5000', 'Dépenses générales', 'expense', 'general', 'debit', 'general_expense'],
];

function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) {
    throw Object.assign(new Error('Montant invalide.'), { statusCode: 400 });
  }
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function assertBalanced(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw Object.assign(new Error('Une écriture doit contenir au moins deux lignes.'), { statusCode: 400 });
  }

  const debit = lines.reduce((sum, line) => sum + money(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + money(line.credit), 0);

  if (debit === 0 || Math.abs(debit - credit) > 0.005) {
    throw Object.assign(
      new Error(`Écriture déséquilibrée : débits ${debit.toFixed(2)} $, crédits ${credit.toFixed(2)} $.`),
      { statusCode: 422 },
    );
  }

  return { debit, credit };
}

async function withTransaction(work, client = db) {
  const transaction = client.connect ? await client.connect() : client;
  const shouldRelease = transaction !== client && typeof transaction.release === 'function';

  try {
    await transaction.query('BEGIN');
    const result = await work(transaction);
    await transaction.query('COMMIT');
    return result;
  } catch (error) {
    await transaction.query('ROLLBACK');
    throw error;
  } finally {
    if (shouldRelease) transaction.release();
  }
}

async function seedDefaultChart({ organisationId, client = db }) {
  const accounts = [];

  for (const [code, name, type, subtype, normalBalance, systemKey] of DEFAULT_CHART) {
    const { rows } = await client.query(
      `INSERT INTO accounting_accounts
        (organisation_id, code, name, type, subtype, normal_balance, system_key, is_system)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
       ON CONFLICT (organisation_id, code)
       DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [organisationId, code, name, type, subtype, normalBalance, systemKey],
    );
    accounts.push(rows[0]);
  }

  return accounts;
}

async function listAccounts({ organisationId, activeOnly = true, client = db }) {
  const { rows } = await client.query(
    `SELECT * FROM accounting_accounts
     WHERE organisation_id = $1 ${activeOnly ? 'AND is_active = TRUE' : ''}
     ORDER BY code`,
    [organisationId],
  );
  return rows;
}

async function createAccount({ organisationId, data, client = db }) {
  if (!ACCOUNT_TYPES.has(data.type)) {
    throw Object.assign(new Error('Type de compte invalide.'), { statusCode: 400 });
  }

  const normalBalance = data.normal_balance || (['asset', 'expense'].includes(data.type) ? 'debit' : 'credit');
  const { rows } = await client.query(
    `INSERT INTO accounting_accounts
      (organisation_id, code, name, type, subtype, parent_id, normal_balance, currency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      organisationId,
      String(data.code || '').trim(),
      String(data.name || '').trim(),
      data.type,
      data.subtype || null,
      data.parent_id || null,
      normalBalance,
      data.currency || 'CAD',
    ],
  );
  return rows[0];
}

async function createPeriod({ organisationId, data, client = db }) {
  const { rows } = await client.query(
    `INSERT INTO accounting_periods (organisation_id, name, starts_on, ends_on, status)
     VALUES ($1,$2,$3,$4,'open')
     RETURNING *`,
    [organisationId, data.name, data.starts_on, data.ends_on],
  );
  return rows[0];
}

async function listPeriods({ organisationId, client = db }) {
  const { rows } = await client.query(
    'SELECT * FROM accounting_periods WHERE organisation_id = $1 ORDER BY starts_on DESC',
    [organisationId],
  );
  return rows;
}

async function setPeriodStatus({ organisationId, periodId, status, userId, client = db }) {
  if (!['open', 'closed', 'locked'].includes(status)) {
    throw Object.assign(new Error('Statut de période invalide.'), { statusCode: 400 });
  }

  const { rows } = await client.query(
    `UPDATE accounting_periods
     SET status = $3,
         closed_at = CASE WHEN $3 = 'open' THEN NULL ELSE NOW() END,
         closed_by = CASE WHEN $3 = 'open' THEN NULL ELSE $4 END
     WHERE id = $1 AND organisation_id = $2
     RETURNING *`,
    [periodId, organisationId, status, userId || null],
  );

  if (!rows[0]) throw Object.assign(new Error('Période introuvable.'), { statusCode: 404 });
  return rows[0];
}

async function getJournalEntry({ organisationId, entryId, client = db }) {
  const entry = await client.query(
    'SELECT * FROM accounting_journal_entries WHERE id = $1 AND organisation_id = $2',
    [entryId, organisationId],
  );
  if (!entry.rows[0]) return null;

  const lines = await client.query(
    `SELECT l.*, a.code AS account_code, a.name AS account_name
     FROM accounting_journal_lines l
     JOIN accounting_accounts a
       ON a.id = l.account_id AND a.organisation_id = l.organisation_id
     WHERE l.entry_id = $1 AND l.organisation_id = $2
     ORDER BY a.code, l.id`,
    [entryId, organisationId],
  );

  return { ...entry.rows[0], lines: lines.rows };
}

async function createJournalEntry({ organisationId, userId, data, client = db }) {
  assertBalanced(data.lines);

  return withTransaction(async (transaction) => {
    const period = await transaction.query(
      `SELECT * FROM accounting_periods
       WHERE id = $1 AND organisation_id = $2
         AND $3::date BETWEEN starts_on AND ends_on
       FOR UPDATE`,
      [data.period_id, organisationId, data.entry_date],
    );

    if (!period.rows[0]) {
      throw Object.assign(new Error('La date ne correspond pas à la période.'), { statusCode: 400 });
    }
    if (period.rows[0].status !== 'open') {
      throw Object.assign(new Error('La période comptable est fermée ou verrouillée.'), { statusCode: 409 });
    }

    if (data.idempotency_key) {
      const existing = await transaction.query(
        `SELECT id FROM accounting_journal_entries
         WHERE organisation_id = $1 AND idempotency_key = $2`,
        [organisationId, data.idempotency_key],
      );
      if (existing.rows[0]) {
        return getJournalEntry({ organisationId, entryId: existing.rows[0].id, client: transaction });
      }
    }

    const inserted = await transaction.query(
      `INSERT INTO accounting_journal_entries
        (organisation_id, entry_date, period_id, description, source_type, source_id,
         idempotency_key, currency, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        organisationId,
        data.entry_date,
        data.period_id,
        data.description,
        data.source_type || null,
        data.source_id || null,
        data.idempotency_key || null,
        data.currency || 'CAD',
        userId || null,
      ],
    );

    for (const line of data.lines) {
      await transaction.query(
        `INSERT INTO accounting_journal_lines
          (organisation_id, entry_id, account_id, description, debit, credit,
           client_id, projet_id, supplier_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          organisationId,
          inserted.rows[0].id,
          line.account_id,
          line.description || null,
          money(line.debit),
          money(line.credit),
          line.client_id || null,
          line.projet_id || null,
          line.supplier_id || null,
        ],
      );
    }

    return getJournalEntry({ organisationId, entryId: inserted.rows[0].id, client: transaction });
  }, client);
}

async function postJournalEntry({ organisationId, entryId, userId, client = db }) {
  return withTransaction(async (transaction) => {
    const entry = await getJournalEntry({ organisationId, entryId, client: transaction });
    if (!entry) throw Object.assign(new Error('Écriture introuvable.'), { statusCode: 404 });
    if (entry.status !== 'draft') {
      throw Object.assign(new Error('Seule une écriture brouillon peut être comptabilisée.'), { statusCode: 409 });
    }

    assertBalanced(entry.lines);
    const period = await transaction.query(
      'SELECT status FROM accounting_periods WHERE id = $1 AND organisation_id = $2 FOR UPDATE',
      [entry.period_id, organisationId],
    );
    if (period.rows[0]?.status !== 'open') {
      throw Object.assign(new Error('La période comptable n’est pas ouverte.'), { statusCode: 409 });
    }

    const { rows } = await transaction.query(
      `UPDATE accounting_journal_entries
       SET status = 'posted', posted_at = NOW(), posted_by = $3
       WHERE id = $1 AND organisation_id = $2 AND status = 'draft'
       RETURNING *`,
      [entryId, organisationId, userId || null],
    );

    return { ...rows[0], lines: entry.lines };
  }, client);
}

async function reverseJournalEntry({ organisationId, entryId, userId, date, periodId, client = db }) {
  const source = await getJournalEntry({ organisationId, entryId, client });
  if (!source || source.status !== 'posted') {
    throw Object.assign(new Error('Seule une écriture comptabilisée peut être contrepassée.'), { statusCode: 409 });
  }

  const reversal = await createJournalEntry({
    organisationId,
    userId,
    client,
    data: {
      entry_date: date,
      period_id: periodId,
      description: `Contrepassation — ${source.description}`,
      source_type: 'reversal',
      source_id: source.id,
      idempotency_key: `reversal:${source.id}`,
      lines: source.lines.map((line) => ({
        account_id: line.account_id,
        debit: line.credit,
        credit: line.debit,
        description: line.description,
      })),
    },
  });

  const posted = await postJournalEntry({ organisationId, entryId: reversal.id, userId, client });
  await client.query(
    `UPDATE accounting_journal_entries
     SET status = 'reversed', reversed_by_entry_id = $3
     WHERE id = $1 AND organisation_id = $2`,
    [entryId, organisationId, posted.id],
  );
  return posted;
}

async function listJournal({ organisationId, from, to, status, client = db }) {
  const params = [organisationId];
  let where = 'e.organisation_id = $1';
  if (from) { params.push(from); where += ` AND e.entry_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND e.entry_date <= $${params.length}`; }
  if (status) { params.push(status); where += ` AND e.status = $${params.length}`; }

  const { rows } = await client.query(
    `SELECT e.*, COALESCE(SUM(l.debit),0) AS total_debit,
            COALESCE(SUM(l.credit),0) AS total_credit
     FROM accounting_journal_entries e
     LEFT JOIN accounting_journal_lines l
       ON l.entry_id = e.id AND l.organisation_id = e.organisation_id
     WHERE ${where}
     GROUP BY e.id
     ORDER BY e.entry_date DESC, e.entry_number DESC`,
    params,
  );
  return rows;
}

async function getLedger({ organisationId, accountId, from, to, client = db }) {
  const { rows } = await client.query(
    `SELECT e.id AS entry_id, e.entry_number, e.entry_date,
            e.description AS entry_description, e.source_type, e.source_id,
            l.description, l.debit, l.credit,
            SUM(CASE WHEN a.normal_balance = 'debit'
                     THEN l.debit - l.credit ELSE l.credit - l.debit END)
              OVER (ORDER BY e.entry_date, e.entry_number, l.id) AS running_balance
     FROM accounting_journal_lines l
     JOIN accounting_journal_entries e
       ON e.id = l.entry_id AND e.organisation_id = l.organisation_id
     JOIN accounting_accounts a
       ON a.id = l.account_id AND a.organisation_id = l.organisation_id
     WHERE l.organisation_id = $1 AND l.account_id = $2
       AND e.status IN ('posted','reversed')
       AND ($3::date IS NULL OR e.entry_date >= $3::date)
       AND ($4::date IS NULL OR e.entry_date <= $4::date)
     ORDER BY e.entry_date, e.entry_number, l.id`,
    [organisationId, accountId, from || null, to || null],
  );
  return rows;
}

async function trialBalance({ organisationId, from, to, client = db }) {
  const { rows } = await client.query(
    `SELECT a.id, a.code, a.name, a.type, a.normal_balance, a.system_key,
            COALESCE(SUM(CASE WHEN e.status IN ('posted','reversed') THEN l.debit ELSE 0 END),0)::numeric(18,2) AS debit,
            COALESCE(SUM(CASE WHEN e.status IN ('posted','reversed') THEN l.credit ELSE 0 END),0)::numeric(18,2) AS credit
     FROM accounting_accounts a
     LEFT JOIN accounting_journal_lines l
       ON l.account_id = a.id AND l.organisation_id = a.organisation_id
     LEFT JOIN accounting_journal_entries e
       ON e.id = l.entry_id AND e.organisation_id = l.organisation_id
       AND ($2::date IS NULL OR e.entry_date >= $2::date)
       AND ($3::date IS NULL OR e.entry_date <= $3::date)
     WHERE a.organisation_id = $1
     GROUP BY a.id
     ORDER BY a.code`,
    [organisationId, from || null, to || null],
  );

  const normalized = rows.map((row) => ({
    ...row,
    net: money(Math.abs(Number(row.debit) - Number(row.credit))),
  }));
  const totalDebit = normalized.reduce((sum, row) => sum + Number(row.debit), 0);
  const totalCredit = normalized.reduce((sum, row) => sum + Number(row.credit), 0);

  return {
    rows: normalized,
    total_debit: money(totalDebit),
    total_credit: money(totalCredit),
    balanced: Math.abs(totalDebit - totalCredit) < 0.005,
  };
}

async function financialStatements({ organisationId, from, to, client = db }) {
  const balance = await trialBalance({ organisationId, from, to, client });
  const signed = (row) => ['asset', 'expense'].includes(row.type)
    ? Number(row.debit) - Number(row.credit)
    : Number(row.credit) - Number(row.debit);
  const accounts = (type) => balance.rows
    .filter((row) => row.type === type)
    .map((row) => ({ ...row, balance: money(signed(row)) }));

  const revenueAccounts = accounts('revenue');
  const expenseAccounts = accounts('expense');
  const assetAccounts = accounts('asset');
  const liabilityAccounts = accounts('liability');
  const equityAccounts = accounts('equity');
  const revenue = revenueAccounts.reduce((sum, row) => sum + row.balance, 0);
  const expenses = expenseAccounts.reduce((sum, row) => sum + row.balance, 0);
  const netIncome = revenue - expenses;

  return {
    income_statement: {
      revenue: money(revenue),
      expenses: money(expenses),
      net_income: money(netIncome),
      accounts: [...revenueAccounts, ...expenseAccounts],
    },
    balance_sheet: {
      assets: assetAccounts,
      liabilities: liabilityAccounts,
      equity: equityAccounts,
      total_assets: money(assetAccounts.reduce((sum, row) => sum + row.balance, 0)),
      total_liabilities: money(liabilityAccounts.reduce((sum, row) => sum + row.balance, 0)),
      total_equity: money(equityAccounts.reduce((sum, row) => sum + row.balance, 0) + netIncome),
    },
    cash_flow: {
      net_cash_movement: money(
        assetAccounts.filter((row) => row.system_key === 'cash').reduce((sum, row) => sum + row.balance, 0),
      ),
    },
    traceable: true,
  };
}

async function findSystemAccount(organisationId, systemKey, client = db) {
  const { rows } = await client.query(
    `SELECT * FROM accounting_accounts
     WHERE organisation_id = $1 AND system_key = $2 AND is_active = TRUE`,
    [organisationId, systemKey],
  );
  if (!rows[0]) {
    throw Object.assign(new Error(`Compte système manquant : ${systemKey}.`), { statusCode: 409 });
  }
  return rows[0];
}

async function automateInvoice({ organisationId, userId, invoice, periodId, client = db }) {
  const receivable = await findSystemAccount(organisationId, 'accounts_receivable', client);
  const revenue = await findSystemAccount(organisationId, 'service_revenue', client);
  const gst = await findSystemAccount(organisationId, 'gst_payable', client);
  const qst = await findSystemAccount(organisationId, 'qst_payable', client);
  const subtotal = money(invoice.subtotal ?? invoice.amount);
  const gstAmount = money(invoice.gst ?? invoice.tps ?? 0);
  const qstAmount = money(invoice.qst ?? invoice.tvq ?? 0);
  const total = money(subtotal + gstAmount + qstAmount);

  return createJournalEntry({
    organisationId,
    userId,
    client,
    data: {
      entry_date: invoice.date,
      period_id: periodId,
      description: `Facture ${invoice.number || invoice.id}`,
      source_type: 'invoice',
      source_id: String(invoice.id),
      idempotency_key: `invoice:${invoice.id}`,
      lines: [
        { account_id: receivable.id, debit: total, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: subtotal },
        ...(gstAmount ? [{ account_id: gst.id, debit: 0, credit: gstAmount }] : []),
        ...(qstAmount ? [{ account_id: qst.id, debit: 0, credit: qstAmount }] : []),
      ],
    },
  });
}

async function automatePayment({ organisationId, userId, payment, periodId, client = db }) {
  const cash = await findSystemAccount(organisationId, 'cash', client);
  const receivable = await findSystemAccount(organisationId, 'accounts_receivable', client);
  const amount = money(payment.amount);

  return createJournalEntry({
    organisationId,
    userId,
    client,
    data: {
      entry_date: payment.date,
      period_id: periodId,
      description: `Paiement ${payment.reference || payment.id}`,
      source_type: 'payment',
      source_id: String(payment.id),
      idempotency_key: `payment:${payment.id}`,
      lines: [
        { account_id: cash.id, debit: amount, credit: 0 },
        { account_id: receivable.id, debit: 0, credit: amount },
      ],
    },
  });
}

module.exports = {
  money,
  assertBalanced,
  seedDefaultChart,
  listAccounts,
  createAccount,
  createPeriod,
  listPeriods,
  setPeriodStatus,
  createJournalEntry,
  getJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  listJournal,
  getLedger,
  trialBalance,
  financialStatements,
  automateInvoice,
  automatePayment,
};
