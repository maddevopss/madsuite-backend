const ACCOUNT_CODES = {
  bank: "1010",
  receivables: "1100",
  taxReceivable: "1300",
  payables: "2000",
  taxPayable: "2100",
  serviceRevenue: "4000",
  generalExpense: "6900",
};

function money(value, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) {
    throw Object.assign(new Error("Le montant comptable est invalide."), { statusCode: 400 });
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

function requireAccounts(accounts, codes) {
  return codes.every((code) => accounts.has(code));
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

  const debit = money(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0));
  const credit = money(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));
  if (debit !== credit) {
    throw Object.assign(new Error("L’écriture automatique est déséquilibrée."), { statusCode: 409 });
  }

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

  for (const line of lines.filter((item) => Number(item.debit || 0) > 0 || Number(item.credit || 0) > 0)) {
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

  const posted = await client.query(
    `UPDATE accounting_entries
     SET status = 'posted', posted_at = NOW()
     WHERE organisation_id = $1 AND id = $2 AND status = 'draft'
     RETURNING id`,
    [organisationId, entry.rows[0].id],
  );
  if (!posted.rowCount) throw new Error("Impossible de publier l’écriture automatique.");

  return { skipped: false, duplicate: false, entryId: entry.rows[0].id };
}

function dateOnly(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
}

async function recordInvoiceFinalizationAccounting({
  client,
  organisationId,
  invoiceId,
  invoiceNumber,
  subtotal,
  taxTotal,
  total,
  issueDate,
  createdBy,
}) {
  const normalizedSubtotal = money(subtotal);
  const normalizedTax = money(taxTotal, { allowZero: true });
  const normalizedTotal = money(total);
  const codes = [ACCOUNT_CODES.receivables, ACCOUNT_CODES.serviceRevenue];
  if (normalizedTax > 0) codes.push(ACCOUNT_CODES.taxPayable);
  const accounts = await loadAccounts(client, organisationId, codes);
  if (!requireAccounts(accounts, codes)) {
    return { skipped: true, reason: "chart_of_accounts_not_initialized" };
  }

  return recordPostedEntry(client, {
    organisationId,
    userId: createdBy,
    journalCode: "VEN",
    journalName: "Journal des ventes",
    journalType: "sales",
    entryNumber: `VEN-FAC-${invoiceId}`,
    entryDate: dateOnly(issueDate),
    description: `Facture ${invoiceNumber || invoiceId}`,
    sourceType: "invoice",
    sourceId: invoiceId,
    lines: [
      { accountId: accounts.get(ACCOUNT_CODES.receivables), description: "Compte client", debit: normalizedTotal, credit: 0 },
      { accountId: accounts.get(ACCOUNT_CODES.serviceRevenue), description: "Revenus", debit: 0, credit: normalizedSubtotal },
      { accountId: accounts.get(ACCOUNT_CODES.taxPayable), description: "Taxes à remettre", debit: 0, credit: normalizedTax },
    ],
  });
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
  const codes = [ACCOUNT_CODES.bank, ACCOUNT_CODES.receivables];
  const accounts = await loadAccounts(client, organisationId, codes);
  if (!requireAccounts(accounts, codes)) {
    return { skipped: true, reason: "chart_of_accounts_not_initialized" };
  }

  return recordPostedEntry(client, {
    organisationId,
    userId: createdBy,
    journalCode: "ENC",
    journalName: "Journal des encaissements",
    journalType: "cash_receipts",
    entryNumber: `ENC-PMT-${paymentId}`,
    entryDate: dateOnly(receivedAt),
    description: `Encaissement de la facture ${invoiceNumber || paymentId}`,
    sourceType: "invoice_payment",
    sourceId: paymentId,
    lines: [
      { accountId: accounts.get(ACCOUNT_CODES.bank), description: "Dépôt au compte bancaire", debit: normalizedAmount, credit: 0 },
      { accountId: accounts.get(ACCOUNT_CODES.receivables), description: "Réduction des comptes clients", debit: 0, credit: normalizedAmount },
    ],
  });
}

async function recordExpenseAccounting({ client, organisationId, expense, createdBy }) {
  const amount = money(expense.amount);
  const tax = money(expense.tax_amount, { allowZero: true });
  const total = money(expense.total_amount);
  const codes = [ACCOUNT_CODES.generalExpense, ACCOUNT_CODES.bank];
  if (tax > 0) codes.push(ACCOUNT_CODES.taxReceivable);
  const accounts = await loadAccounts(client, organisationId, codes);
  if (!requireAccounts(accounts, codes)) {
    return { skipped: true, reason: "chart_of_accounts_not_initialized" };
  }

  return recordPostedEntry(client, {
    organisationId,
    userId: createdBy,
    journalCode: "DEC",
    journalName: "Journal des décaissements",
    journalType: "cash_disbursements",
    entryNumber: `DEC-DEP-${expense.id}`,
    entryDate: dateOnly(expense.expense_date),
    description: expense.description || `Dépense ${expense.id}`,
    sourceType: "expense",
    sourceId: expense.id,
    lines: [
      { accountId: accounts.get(ACCOUNT_CODES.generalExpense), description: expense.category || "Dépense", debit: amount, credit: 0 },
      { accountId: accounts.get(ACCOUNT_CODES.taxReceivable), description: "Taxes à recevoir", debit: tax, credit: 0 },
      { accountId: accounts.get(ACCOUNT_CODES.bank), description: "Paiement", debit: 0, credit: total },
    ],
  });
}

async function recordSupplierBillAccounting({ client, organisationId, bill, createdBy }) {
  const subtotal = money(bill.subtotal);
  const tax = money(bill.tax_total, { allowZero: true });
  const total = money(bill.total);
  const codes = [ACCOUNT_CODES.generalExpense, ACCOUNT_CODES.payables];
  if (tax > 0) codes.push(ACCOUNT_CODES.taxReceivable);
  const accounts = await loadAccounts(client, organisationId, codes);
  if (!requireAccounts(accounts, codes)) {
    return { skipped: true, reason: "chart_of_accounts_not_initialized" };
  }

  return recordPostedEntry(client, {
    organisationId,
    userId: createdBy,
    journalCode: "ACH",
    journalName: "Journal des achats",
    journalType: "purchases",
    entryNumber: `ACH-FOU-${bill.id}`,
    entryDate: dateOnly(bill.bill_date),
    description: `Facture fournisseur ${bill.bill_number}`,
    sourceType: "supplier_bill",
    sourceId: bill.id,
    lines: [
      { accountId: accounts.get(ACCOUNT_CODES.generalExpense), description: "Achat fournisseur", debit: subtotal, credit: 0 },
      { accountId: accounts.get(ACCOUNT_CODES.taxReceivable), description: "Taxes à recevoir", debit: tax, credit: 0 },
      { accountId: accounts.get(ACCOUNT_CODES.payables), description: "Compte fournisseur", debit: 0, credit: total },
    ],
  });
}

module.exports = {
  ACCOUNT_CODES,
  money,
  loadAccounts,
  findExistingEntry,
  recordPostedEntry,
  recordInvoiceFinalizationAccounting,
  recordInvoicePaymentAccounting,
  recordExpenseAccounting,
  recordSupplierBillAccounting,
};