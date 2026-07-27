function normalizeLedgerFilters(filters = {}) {
  const normalized = {
    accountId: filters.accountId ? Number(filters.accountId) : null,
    startDate: filters.startDate || null,
    endDate: filters.endDate || null,
    sourceType: filters.sourceType || null,
    sourceId: filters.sourceId ? String(filters.sourceId) : null,
    projectId: filters.projectId ? String(filters.projectId) : null,
    clientId: filters.clientId ? String(filters.clientId) : null,
    supplierId: filters.supplierId ? String(filters.supplierId) : null,
  };

  for (const key of ["accountId"]) {
    if (normalized[key] !== null && (!Number.isInteger(normalized[key]) || normalized[key] <= 0)) {
      throw Object.assign(new Error("Le filtre de compte est invalide."), { status: 400 });
    }
  }

  if (normalized.startDate && normalized.endDate && normalized.startDate > normalized.endDate) {
    throw Object.assign(new Error("La date de début doit précéder la date de fin."), { status: 400 });
  }

  return normalized;
}

async function getLedger(db, organisationId, filters = {}) {
  const normalized = normalizeLedgerFilters(filters);
  const values = [
    organisationId,
    normalized.accountId,
    normalized.startDate,
    normalized.endDate,
    normalized.sourceType,
    normalized.sourceId,
    normalized.projectId,
    normalized.clientId,
    normalized.supplierId,
  ];

  const { rows } = await db.query(
    `WITH filtered_entries AS (
       SELECT e.*
       FROM accounting_entries e
       WHERE e.organisation_id = $1
         AND e.status IN ('posted', 'reversed')
         AND ($3::date IS NULL OR e.entry_date >= $3::date)
         AND ($4::date IS NULL OR e.entry_date <= $4::date)
         AND ($5::text IS NULL OR e.source_type = $5::text)
         AND ($6::text IS NULL OR e.source_id = $6::text)
         AND ($7::text IS NULL OR COALESCE(e.metadata->>'projectId', e.metadata->>'project_id') = $7::text)
         AND ($8::text IS NULL OR COALESCE(e.metadata->>'clientId', e.metadata->>'client_id') = $8::text)
         AND ($9::text IS NULL OR COALESCE(e.metadata->>'supplierId', e.metadata->>'supplier_id') = $9::text)
     ),
     opening_balances AS (
       SELECT l.account_id,
              COALESCE(SUM(l.debit - l.credit), 0)::numeric AS opening_balance
       FROM accounting_entry_lines l
       JOIN accounting_entries e
         ON e.id = l.entry_id
        AND e.organisation_id = l.organisation_id
       WHERE l.organisation_id = $1
         AND e.status IN ('posted', 'reversed')
         AND ($2::bigint IS NULL OR l.account_id = $2::bigint)
         AND $3::date IS NOT NULL
         AND e.entry_date < $3::date
       GROUP BY l.account_id
     )
     SELECT a.id AS account_id,
            a.code,
            a.name AS account_name,
            a.account_type,
            e.id AS entry_id,
            e.entry_number,
            e.entry_date,
            e.description AS entry_description,
            e.source_type,
            e.source_id,
            e.metadata,
            l.id AS line_id,
            l.description AS line_description,
            l.debit::numeric,
            l.credit::numeric,
            COALESCE(ob.opening_balance, 0)::numeric AS opening_balance,
            (COALESCE(ob.opening_balance, 0) +
             SUM(l.debit - l.credit) OVER (
               PARTITION BY a.id
               ORDER BY e.entry_date, e.id, l.id
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ))::numeric AS running_balance
     FROM accounting_entry_lines l
     JOIN filtered_entries e
       ON e.id = l.entry_id
      AND e.organisation_id = l.organisation_id
     JOIN accounting_accounts a
       ON a.id = l.account_id
      AND a.organisation_id = l.organisation_id
     LEFT JOIN opening_balances ob ON ob.account_id = a.id
     WHERE l.organisation_id = $1
       AND ($2::bigint IS NULL OR a.id = $2::bigint)
     ORDER BY a.code, e.entry_date, e.id, l.id`,
    values,
  );

  const accounts = new Map();
  for (const row of rows) {
    if (!accounts.has(row.account_id)) {
      accounts.set(row.account_id, {
        accountId: row.account_id,
        code: row.code,
        name: row.account_name,
        accountType: row.account_type,
        openingBalance: Number(row.opening_balance || 0),
        debit: 0,
        credit: 0,
        closingBalance: Number(row.opening_balance || 0),
        movements: [],
      });
    }

    const account = accounts.get(row.account_id);
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);
    account.debit = Number((account.debit + debit).toFixed(2));
    account.credit = Number((account.credit + credit).toFixed(2));
    account.closingBalance = Number(Number(row.running_balance || account.closingBalance).toFixed(2));
    account.movements.push({
      entryId: row.entry_id,
      entryNumber: row.entry_number,
      entryDate: row.entry_date,
      entryDescription: row.entry_description,
      lineId: row.line_id,
      lineDescription: row.line_description,
      debit,
      credit,
      runningBalance: Number(row.running_balance || 0),
      source: {
        type: row.source_type,
        id: row.source_id,
        metadata: row.metadata || {},
      },
    });
  }

  return {
    filters: normalized,
    accounts: Array.from(accounts.values()),
    totals: Array.from(accounts.values()).reduce(
      (acc, account) => ({
        debit: Number((acc.debit + account.debit).toFixed(2)),
        credit: Number((acc.credit + account.credit).toFixed(2)),
      }),
      { debit: 0, credit: 0 },
    ),
  };
}

module.exports = { normalizeLedgerFilters, getLedger };
