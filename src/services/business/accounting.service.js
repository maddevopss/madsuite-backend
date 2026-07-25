function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function createEntry(db, organisationId, userId, payload) {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (lines.length < 2) {
    throw Object.assign(new Error("Une écriture exige au moins deux lignes."), { status: 400 });
  }

  const debit = money(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0));
  const credit = money(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));
  if (debit <= 0 || debit !== credit) {
    throw Object.assign(new Error("Les débits et crédits doivent être égaux et supérieurs à zéro."), { status: 400 });
  }

  await db.query("BEGIN");
  try {
    const journalCode = payload.journalCode || "GEN";
    await db.query(
      `INSERT INTO accounting_journals (organisation_id, code, name, journal_type)
       VALUES ($1, $2, $3, 'general')
       ON CONFLICT (organisation_id, code) DO NOTHING`,
      [organisationId, journalCode, payload.journalName || "Journal général"],
    );

    const journal = await db.query(
      "SELECT id FROM accounting_journals WHERE organisation_id = $1 AND code = $2",
      [organisationId, journalCode],
    );

    const entry = await db.query(
      `INSERT INTO accounting_entries
       (organisation_id, journal_id, entry_number, entry_date, description, source_type, source_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        organisationId,
        journal.rows[0].id,
        payload.entryNumber || `GEN-${Date.now()}`,
        payload.entryDate,
        payload.description,
        payload.sourceType || null,
        payload.sourceId || null,
        userId || null,
      ],
    );

    for (const line of lines) {
      await db.query(
        `INSERT INTO accounting_entry_lines
         (organisation_id, entry_id, account_id, description, debit, credit)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          organisationId,
          entry.rows[0].id,
          line.accountId,
          line.description || null,
          money(line.debit),
          money(line.credit),
        ],
      );
    }

    await db.query("COMMIT");
    return entry.rows[0];
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function postEntry(db, organisationId, id) {
  const totals = await db.query(
    `SELECT e.status,
            COALESCE(SUM(l.debit), 0)::numeric debit,
            COALESCE(SUM(l.credit), 0)::numeric credit
     FROM accounting_entries e
     JOIN accounting_entry_lines l ON l.entry_id = e.id
     WHERE e.organisation_id = $1 AND e.id = $2
     GROUP BY e.id`,
    [organisationId, id],
  );

  if (!totals.rowCount) return null;
  if (money(totals.rows[0].debit) !== money(totals.rows[0].credit)) {
    throw Object.assign(new Error("Écriture déséquilibrée."), { status: 409 });
  }

  const result = await db.query(
    `UPDATE accounting_entries
     SET status = 'posted', posted_at = NOW()
     WHERE organisation_id = $1 AND id = $2 AND status = 'draft'
     RETURNING *`,
    [organisationId, id],
  );
  return result.rows[0] || null;
}

async function trialBalance(db, organisationId, startDate, endDate) {
  const { rows } = await db.query(
    `SELECT a.id, a.code, a.name, a.account_type,
            COALESCE(SUM(CASE WHEN e.status = 'posted' THEN l.debit ELSE 0 END), 0)::numeric AS debit,
            COALESCE(SUM(CASE WHEN e.status = 'posted' THEN l.credit ELSE 0 END), 0)::numeric AS credit,
            (COALESCE(SUM(CASE WHEN e.status = 'posted' THEN l.debit ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN e.status = 'posted' THEN l.credit ELSE 0 END), 0))::numeric AS balance
     FROM accounting_accounts a
     LEFT JOIN accounting_entry_lines l ON l.account_id = a.id
     LEFT JOIN accounting_entries e ON e.id = l.entry_id
       AND ($2::date IS NULL OR e.entry_date >= $2::date)
       AND ($3::date IS NULL OR e.entry_date <= $3::date)
     WHERE a.organisation_id = $1
     GROUP BY a.id
     ORDER BY a.code`,
    [organisationId, startDate || null, endDate || null],
  );
  return rows;
}

async function statements(db, organisationId, endDate) {
  const rows = await trialBalance(db, organisationId, null, endDate);
  const sum = (type) => money(rows.filter((row) => row.account_type === type).reduce((total, row) => total + Number(row.balance), 0));
  const revenue = -sum("revenue");
  const expenses = sum("expense");
  return {
    asOf: endDate || new Date().toISOString().slice(0, 10),
    incomeStatement: { revenue, expenses, netIncome: money(revenue - expenses) },
    balanceSheet: { assets: sum("asset"), liabilities: -sum("liability"), equity: -sum("equity") },
  };
}

module.exports = { createEntry, postEntry, trialBalance, statements };
