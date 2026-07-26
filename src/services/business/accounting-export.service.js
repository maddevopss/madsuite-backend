function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function toCsv(headers, rows) {
  return [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n');
}

async function trialBalanceCsv(db, organisationId, startDate, endDate) {
  const { rows } = await db.query(
    `SELECT a.code, a.name, a.account_type,
            COALESCE(SUM(CASE WHEN e.status IN ('posted','reversed') THEN l.debit ELSE 0 END),0)::numeric AS debit,
            COALESCE(SUM(CASE WHEN e.status IN ('posted','reversed') THEN l.credit ELSE 0 END),0)::numeric AS credit,
            (COALESCE(SUM(CASE WHEN e.status IN ('posted','reversed') THEN l.debit ELSE 0 END),0)
             - COALESCE(SUM(CASE WHEN e.status IN ('posted','reversed') THEN l.credit ELSE 0 END),0))::numeric AS balance
     FROM accounting_accounts a
     LEFT JOIN accounting_entry_lines l ON l.account_id=a.id AND l.organisation_id=a.organisation_id
     LEFT JOIN accounting_entries e ON e.id=l.entry_id
       AND ($2::date IS NULL OR e.entry_date >= $2::date)
       AND ($3::date IS NULL OR e.entry_date <= $3::date)
     WHERE a.organisation_id=$1
     GROUP BY a.id
     ORDER BY a.code`,
    [organisationId, startDate || null, endDate || null],
  );

  return toCsv(
    ['Compte', 'Nom', 'Type', 'Débit', 'Crédit', 'Solde'],
    rows.map((row) => [row.code, row.name, row.account_type, row.debit, row.credit, row.balance]),
  );
}

async function journalCsv(db, organisationId, startDate, endDate) {
  const { rows } = await db.query(
    `SELECT e.entry_date, e.entry_number, e.description AS entry_description,
            a.code AS account_code, a.name AS account_name,
            l.description AS line_description, l.debit, l.credit,
            e.source_type, e.source_id
     FROM accounting_entries e
     JOIN accounting_entry_lines l ON l.entry_id=e.id AND l.organisation_id=e.organisation_id
     JOIN accounting_accounts a ON a.id=l.account_id AND a.organisation_id=l.organisation_id
     WHERE e.organisation_id=$1
       AND ($2::date IS NULL OR e.entry_date >= $2::date)
       AND ($3::date IS NULL OR e.entry_date <= $3::date)
     ORDER BY e.entry_date,e.id,l.id`,
    [organisationId, startDate || null, endDate || null],
  );

  return toCsv(
    ['Date', 'Écriture', 'Description', 'Compte', 'Nom du compte', 'Ligne', 'Débit', 'Crédit', 'Source', 'Référence'],
    rows.map((row) => [row.entry_date, row.entry_number, row.entry_description, row.account_code,
      row.account_name, row.line_description, row.debit, row.credit, row.source_type, row.source_id]),
  );
}

async function cashFlow(db, organisationId, startDate, endDate) {
  const { rows } = await db.query(
    `SELECT e.entry_date, e.entry_number, e.description, e.source_type, e.source_id,
            SUM(CASE WHEN a.code LIKE '10%' THEN l.debit-l.credit ELSE 0 END)::numeric AS cash_movement
     FROM accounting_entries e
     JOIN accounting_entry_lines l ON l.entry_id=e.id AND l.organisation_id=e.organisation_id
     JOIN accounting_accounts a ON a.id=l.account_id AND a.organisation_id=l.organisation_id
     WHERE e.organisation_id=$1 AND e.status IN ('posted','reversed')
       AND ($2::date IS NULL OR e.entry_date >= $2::date)
       AND ($3::date IS NULL OR e.entry_date <= $3::date)
     GROUP BY e.id
     HAVING SUM(CASE WHEN a.code LIKE '10%' THEN l.debit-l.credit ELSE 0 END) <> 0
     ORDER BY e.entry_date,e.id`,
    [organisationId, startDate || null, endDate || null],
  );

  const movements = rows.map((row) => ({ ...row, cash_movement: Number(row.cash_movement) }));
  return {
    startDate: startDate || null,
    endDate: endDate || null,
    movements,
    netCashMovement: Number(movements.reduce((sum, row) => sum + row.cash_movement, 0).toFixed(2)),
    traceable: true,
  };
}

module.exports = { csvCell, toCsv, trialBalanceCsv, journalCsv, cashFlow };
