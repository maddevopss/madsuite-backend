const ACCOUNT_CODES = {
  bank: "1010",
  receivables: "1100",
};

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw Object.assign(new Error("Le montant comptable doit être supérieur à zéro."), { statusCode: 400 });
  }
  return Number(number.toFixed(2));
}

async function loadAccounts(client, organisationId, codes) {
  const { rows } = await client.query(
    `SELECT id, code
     FROM accounting_accounts
     WHERE organisation_id = $1
       AND code = ANY($2::varchar[])
       AND is_active = TRUE`,
    [organisationId, codes],
  );
  return new Map(rows.map((row) => [row.code, row.id]));
}

async function findExistingEntry(client, organisationId, sourceType, sourceId) {
  const { rows } = await client.query(
    `SELECT id, status
     FROM accounting_entries
     WHERE organisation_id = $1
       AND source_type = $2
       AND source_id = $3
       AND status <> 'reversed'
     LIMIT 1`,
    [organisationId, sourceType, String(sourceId)],
  );
  return rows[0] || null;
}

async function ensureJournal(client, organisationId, code, name, type) {
  await client.query(
    `INSERT INTO accounting_journals (organisation_id, code, name, journal_type)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (organisation_id, code) DO NOTHING`,
    [organisationId, code, name, type],
  );
  const { rows } = await client.query(
    `SELECT id FROM accounting_journals WHERE organisation_id = $1 AND code = $2`,
    [organisationId, code],
  );
  return rows[0]?.id || null;
}

async function recordPostedEntry(client, {
  organisationId,
  userId,
  journalCode,
  journalName,
  journalType,
  entryNumber,
  entryDate,
  description,
  sourceType,
  sourceId,
  lines,
}) {
  const existing = await findExistingEntry(client, organisationId, sourceType, sourceId);
  if (existing) return { skipped: false, duplicate: true, entryId: existing.id };

  const journalId = await ensureJournal(client, organisationId, journalCode, journalName, journalType);
  if (!journalId) throw new Error("Journal comptable introuvable.");

  const entry = await client.query(
    `INSERT INTO accounting_entries
      (organisation_id, journal_id, entry_number, entry_date, description,
       source_type, source_id, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)
     RETURNING id`,
    [
      organisationId,
      journalId,
      entryNumber,
      entryDate,
      description,
      sourceType,
      String(sourceId),
      userId || null,
    ],
  );

  for (const line of lines) {
    await client.query(
      `INSERT INTO accounting_entry_lines
        (organisation_id, entry_id, account_id, description, debit, credit)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        organisationId,
        entry.rows[0].id,
        line.accountId,
        line.description || null,
        Number(line.debit || 0).toFixed(2),
        Number(line.credit || 0).toFixed(2),
      ],
    );
  }

  await client.query(
    `UPDATE accounting_entries
     SET status = 'posted', posted_at = NOW()
     WHERE organisation_id = $1 AND id = $2 AND status = 'draft'`,
    [organisationId, entry.rows[0].id],
  );

  return { skipped: false, duplicate: false, entryId: entry.rows[0].id };
}

async function recordInvoicePaymentAccounting({
  client,
  organisationId,
  paymentId,
  invoiceNumber,
  amount,
  receivedAt,
  createdBy,
}) {
  const normalizedAmount = money(amount);
  const accounts = await loadAccounts(client, organisationId, [ACCOUNT_CODES.bank, ACCOUNT_CODES.receivables]);

  if (!accounts.has(ACCOUNT_CODES.bank) || !accounts.has(ACCOUNT_CODES.receivables)) {
    return {
      skipped: true,
      reason: "chart_of_accounts_not_initialized",
    };
  }

  const date = receivedAt ? new Date(receivedAt) : new Date();
  const entryDate = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);

  return recordPostedEntry(client, {
    organisationId,
    userId: createdBy,
    journalCode: "ENC",
    journalName: "Journal des encaissements",
    journalType: "cash_receipts",
    entryNumber: `ENC-PMT-${paymentId}`,
    entryDate,
    description: `Encaissement de la facture ${invoiceNumber || paymentId}`,
    sourceType: "invoice_payment",
    sourceId: paymentId,
    lines: [
      {
        accountId: accounts.get(ACCOUNT_CODES.bank),
        description: "Dépôt au compte bancaire",
        debit: normalizedAmount,
        credit: 0,
      },
      {
        accountId: accounts.get(ACCOUNT_CODES.receivables),
        description: "Réduction des comptes clients",
        debit: 0,
        credit: normalizedAmount,
      },
    ],
  });
}

module.exports = {
  ACCOUNT_CODES,
  money,
  loadAccounts,
  findExistingEntry,
  recordInvoicePaymentAccounting,
};