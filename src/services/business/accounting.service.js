function money(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    throw Object.assign(new Error("Montant comptable invalide."), { status: 400 });
  }
  return Number(numeric.toFixed(2));
}

function validateEntryLines(input) {
  const lines = Array.isArray(input) ? input : [];
  if (lines.length < 2) {
    throw Object.assign(new Error("Une écriture exige au moins deux lignes."), { status: 400 });
  }

  const normalized = lines.map((line) => {
    const debit = money(line.debit);
    const credit = money(line.credit);
    if (!line.accountId || debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) {
      throw Object.assign(new Error("Chaque ligne doit contenir un compte et un seul montant, au débit ou au crédit."), {
        status: 400,
      });
    }
    return { ...line, debit, credit };
  });

  const debit = money(normalized.reduce((sum, line) => sum + line.debit, 0));
  const credit = money(normalized.reduce((sum, line) => sum + line.credit, 0));
  if (debit <= 0 || debit !== credit) {
    throw Object.assign(new Error("Les débits et crédits doivent être égaux et supérieurs à zéro."), { status: 400 });
  }

  return { lines: normalized, debit, credit };
}

async function seedDefaultChart(db, organisationId) {
  const { rows } = await db.query("SELECT seed_default_chart_of_accounts($1)::integer AS inserted", [organisationId]);
  return Number(rows[0]?.inserted || 0);
}

async function createEntry(db, organisationId, userId, payload) {
  if (!payload?.entryDate || !payload?.description) {
    throw Object.assign(new Error("La date et la description de l’écriture sont obligatoires."), { status: 400 });
  }

  const validated = validateEntryLines(payload.lines);

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
        payload.entryNumber || `${journalCode}-${Date.now()}`,
        payload.entryDate,
        payload.description,
        payload.sourceType || null,
        payload.sourceId || null,
        userId || null,
      ],
    );

    for (const line of validated.lines) {
      await db.query(
        `INSERT INTO accounting_entry_lines
         (organisation_id, entry_id, account_id, description, debit, credit)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [organisationId, entry.rows[0].id, line.accountId, line.description || null, line.debit, line.credit],
      );
    }

    await db.query("COMMIT");
    return { ...entry.rows[0], debit: validated.debit, credit: validated.credit };
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

async function reverseEntry(db, organisationId, userId, id, reversalDate, reason) {
  await db.query("BEGIN");
  try {
    const original = await db.query(
      `SELECT e.*, j.code AS journal_code
       FROM accounting_entries e
       JOIN accounting_journals j ON j.id = e.journal_id
       WHERE e.organisation_id = $1 AND e.id = $2 AND e.status = 'posted'
       FOR UPDATE`,
      [organisationId, id],
    );
    if (!original.rowCount) {
      throw Object.assign(new Error("Écriture publiée introuvable."), { status: 404 });
    }

    const lines = await db.query(
      `SELECT account_id AS "accountId", description, credit AS debit, debit AS credit
       FROM accounting_entry_lines
       WHERE organisation_id = $1 AND entry_id = $2
       ORDER BY id`,
      [organisationId, id],
    );

    const reversal = await createEntryWithinTransaction(db, organisationId, userId, {
      journalId: original.rows[0].journal_id,
      entryNumber: `REV-${original.rows[0].entry_number}-${Date.now()}`,
      entryDate: reversalDate,
      description: reason || `Renversement de ${original.rows[0].entry_number}`,
      sourceType: "accounting_reversal",
      sourceId: String(id),
      lines: lines.rows,
    });

    await db.query(
      "UPDATE accounting_entries SET status = 'reversed' WHERE organisation_id = $1 AND id = $2",
      [organisationId, id],
    );
    await db.query(
      "UPDATE accounting_entries SET status = 'posted', posted_at = NOW() WHERE organisation_id = $1 AND id = $2",
      [organisationId, reversal.id],
    );

    await db.query("COMMIT");
    return reversal;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function createEntryWithinTransaction(db, organisationId, userId, payload) {
  const validated = validateEntryLines(payload.lines);
  const entry = await db.query(
    `INSERT INTO accounting_entries
     (organisation_id, journal_id, entry_number, entry_date, description, source_type, source_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [organisationId, payload.journalId, payload.entryNumber, payload.entryDate, payload.description,
      payload.sourceType || null, payload.sourceId || null, userId || null],
  );
  for (const line of validated.lines) {
    await db.query(
      `INSERT INTO accounting_entry_lines
       (organisation_id, entry_id, account_id, description, debit, credit)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [organisationId, entry.rows[0].id, line.accountId, line.description || null, line.debit, line.credit],
    );
  }
  return entry.rows[0];
}

async function ledger(db, organisationId, filters = {}) {
  const { rows } = await db.query(
    `SELECT a.code, a.name AS account_name, e.id AS entry_id, e.entry_number, e.entry_date,
            e.description AS entry_description, l.description AS line_description,
            l.debit::numeric, l.credit::numeric,
            SUM(l.debit - l.credit) OVER (
              PARTITION BY a.id ORDER BY e.entry_date, e.id, l.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            )::numeric AS running_balance
     FROM accounting_entry_lines l
     JOIN accounting_entries e ON e.id = l.entry_id AND e.organisation_id = l.organisation_id
     JOIN accounting_accounts a ON a.id = l.account_id AND a.organisation_id = l.organisation_id
     WHERE l.organisation_id = $1
       AND e.status IN ('posted','reversed')
       AND ($2::bigint IS NULL OR a.id = $2::bigint)
       AND ($3::date IS NULL OR e.entry_date >= $3::date)
       AND ($4::date IS NULL OR e.entry_date <= $4::date)
     ORDER BY a.code, e.entry_date, e.id, l.id`,
    [organisationId, filters.accountId || null, filters.startDate || null, filters.endDate || null],
  );
  return rows;
}

async function trialBalance(db, organisationId, startDate, endDate) {
  const { rows } = await db.query(
    `SELECT a.id, a.code, a.name, a.account_type,
            COALESCE(SUM(CASE WHEN e.status IN ('posted','reversed') THEN l.debit ELSE 0 END), 0)::numeric AS debit,
            COALESCE(SUM(CASE WHEN e.status IN ('posted','reversed') THEN l.credit ELSE 0 END), 0)::numeric AS credit,
            (COALESCE(SUM(CASE WHEN e.status IN ('posted','reversed') THEN l.debit ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN e.status IN ('posted','reversed') THEN l.credit ELSE 0 END), 0))::numeric AS balance
     FROM accounting_accounts a
     LEFT JOIN accounting_entry_lines l ON l.account_id = a.id AND l.organisation_id = a.organisation_id
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
  const sum = (type) => money(rows.filter((row) => row.account_type === type)
    .reduce((total, row) => total + Number(row.balance), 0));
  const revenue = -sum("revenue");
  const expenses = sum("expense");
  return {
    asOf: endDate || new Date().toISOString().slice(0, 10),
    incomeStatement: { revenue, expenses, netIncome: money(revenue - expenses) },
    balanceSheet: { assets: sum("asset"), liabilities: -sum("liability"), equity: -sum("equity") },
  };
}

module.exports = {
  money,
  validateEntryLines,
  seedDefaultChart,
  createEntry,
  postEntry,
  reverseEntry,
  ledger,
  trialBalance,
  statements,
};
