function toMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function notFound(message) {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

async function createStatement(db, organisationId, payload) {
  const { accountId, periodStart, periodEnd, openingBalance, closingBalance } = payload || {};
  if (!accountId) throw badRequest("Le compte bancaire est obligatoire.");
  if (!periodStart || !periodEnd) throw badRequest("La période du relevé est obligatoire.");
  if (periodStart > periodEnd) throw badRequest("La date de début doit précéder la date de fin.");

  const account = await db.query(
    `SELECT id FROM accounting_accounts WHERE organisation_id=$1 AND id=$2 AND is_active=TRUE`,
    [organisationId, accountId],
  );
  if (!account.rowCount) throw badRequest("Le compte bancaire est introuvable ou inactif.");

  const { rows } = await db.query(
    `INSERT INTO bank_statements (organisation_id, account_id, period_start, period_end, opening_balance, closing_balance, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [organisationId, accountId, periodStart, periodEnd, toMoney(openingBalance), toMoney(closingBalance), payload.createdBy || null],
  );
  return rows[0];
}

async function getStatement(db, organisationId, statementId) {
  const { rows } = await db.query(
    `SELECT * FROM bank_statements WHERE organisation_id=$1 AND id=$2`,
    [organisationId, statementId],
  );
  return rows[0] || null;
}

async function listStatements(db, organisationId, { accountId } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM bank_statements WHERE organisation_id=$1 AND ($2::bigint IS NULL OR account_id=$2) ORDER BY period_start DESC`,
    [organisationId, accountId || null],
  );
  return rows;
}

async function requireOpenStatement(db, organisationId, statementId) {
  const statement = await getStatement(db, organisationId, statementId);
  if (!statement) throw notFound("Relevé bancaire introuvable.");
  if (statement.status === "locked") throw conflict("Ce relevé est verrouillé et ne peut plus être modifié.");
  return statement;
}

async function addStatementLines(db, organisationId, statementId, lines) {
  await requireOpenStatement(db, organisationId, statementId);
  if (!Array.isArray(lines) || !lines.length) throw badRequest("Au moins une ligne de relevé est requise.");

  const inserted = [];
  for (const line of lines) {
    if (!line.lineDate || !line.description || line.amount === undefined || line.amount === null) {
      throw badRequest("Chaque ligne de relevé exige une date, une description et un montant.");
    }
    const { rows } = await db.query(
      `INSERT INTO bank_statement_lines (organisation_id, statement_id, line_date, description, amount, external_reference)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [organisationId, statementId, line.lineDate, line.description, toMoney(line.amount), line.externalReference || null],
    );
    inserted.push(rows[0]);
  }
  return inserted;
}

async function listStatementLines(db, organisationId, statementId) {
  const { rows } = await db.query(
    `SELECT * FROM bank_statement_lines WHERE organisation_id=$1 AND statement_id=$2 ORDER BY line_date, id`,
    [organisationId, statementId],
  );
  return rows;
}

// Une ligne de relevé ne correspond qu'à un seul mouvement du grand livre
// sur le MÊME compte que le relevé (contrainte UNIQUE(organisation_id,
// matched_entry_line_id) empêchant qu'une ligne d'écriture serve deux fois),
// et le montant doit concorder exactement au mouvement net (débit - crédit)
// de cette ligne — aucune correspondance approximative dans ce micro-bloc.
async function matchLine(db, organisationId, statementLineId, { entryLineId, matchedBy }) {
  if (!entryLineId) throw badRequest("La ligne d'écriture à faire correspondre est obligatoire.");

  const lineResult = await db.query(
    `SELECT l.*, s.account_id AS statement_account_id, s.status AS statement_status
     FROM bank_statement_lines l
     JOIN bank_statements s ON s.id = l.statement_id AND s.organisation_id = l.organisation_id
     WHERE l.organisation_id=$1 AND l.id=$2`,
    [organisationId, statementLineId],
  );
  const line = lineResult.rows[0];
  if (!line) throw notFound("Ligne de relevé introuvable.");
  if (line.statement_status === "locked") throw conflict("Ce relevé est verrouillé et ne peut plus être modifié.");
  if (line.status === "matched") throw conflict("Cette ligne de relevé possède déjà une correspondance.");

  const entryLineResult = await db.query(
    `SELECT * FROM accounting_entry_lines WHERE organisation_id=$1 AND id=$2 AND account_id=$3`,
    [organisationId, entryLineId, line.statement_account_id],
  );
  const entryLine = entryLineResult.rows[0];
  if (!entryLine) throw badRequest("La ligne d'écriture est introuvable ou ne porte pas sur le compte de ce relevé.");

  const netMovement = toMoney(Number(entryLine.debit) - Number(entryLine.credit));
  if (netMovement !== toMoney(line.amount)) {
    throw badRequest(`Le montant de la ligne d'écriture (${netMovement}) ne correspond pas au montant du relevé (${toMoney(line.amount)}).`);
  }

  try {
    const { rows } = await db.query(
      `UPDATE bank_statement_lines
       SET status='matched', matched_entry_line_id=$3, matched_at=NOW(), matched_by=$4
       WHERE organisation_id=$1 AND id=$2
       RETURNING *`,
      [organisationId, statementLineId, entryLineId, matchedBy || null],
    );
    return rows[0];
  } catch (error) {
    if (error?.code === "23505") throw conflict("Cette ligne d'écriture est déjà associée à une autre ligne de relevé.");
    throw error;
  }
}

async function unmatchLine(db, organisationId, statementLineId) {
  const lineResult = await db.query(
    `SELECT l.*, s.status AS statement_status
     FROM bank_statement_lines l
     JOIN bank_statements s ON s.id = l.statement_id AND s.organisation_id = l.organisation_id
     WHERE l.organisation_id=$1 AND l.id=$2`,
    [organisationId, statementLineId],
  );
  const line = lineResult.rows[0];
  if (!line) throw notFound("Ligne de relevé introuvable.");
  if (line.statement_status === "locked") throw conflict("Ce relevé est verrouillé et ne peut plus être modifié.");
  if (line.status !== "matched") throw conflict("Cette ligne de relevé n'a pas de correspondance à retirer.");

  const { rows } = await db.query(
    `UPDATE bank_statement_lines
     SET status='unmatched', matched_entry_line_id=NULL, matched_at=NULL, matched_by=NULL
     WHERE organisation_id=$1 AND id=$2
     RETURNING *`,
    [organisationId, statementLineId],
  );
  return rows[0];
}

async function getReconciliationSummary(db, organisationId, statementId) {
  const statement = await getStatement(db, organisationId, statementId);
  if (!statement) throw notFound("Relevé bancaire introuvable.");
  const lines = await listStatementLines(db, organisationId, statementId);

  const totals = lines.reduce(
    (acc, line) => {
      const amount = Number(line.amount);
      acc.allLinesTotal = toMoney(acc.allLinesTotal + amount);
      if (line.status === "matched") acc.matchedTotal = toMoney(acc.matchedTotal + amount);
      else if (line.status === "unmatched") acc.unmatchedCount += 1;
      return acc;
    },
    { allLinesTotal: 0, matchedTotal: 0, unmatchedCount: 0 },
  );

  const expectedClosing = toMoney(Number(statement.opening_balance) + totals.allLinesTotal);
  const difference = toMoney(Number(statement.closing_balance) - expectedClosing);

  return {
    statement,
    lineCount: lines.length,
    matchedCount: lines.length - totals.unmatchedCount,
    unmatchedCount: totals.unmatchedCount,
    matchedTotal: totals.matchedTotal,
    allLinesTotal: totals.allLinesTotal,
    expectedClosing,
    difference,
    fullyReconciled: totals.unmatchedCount === 0 && difference === 0,
  };
}

// Un relevé ne se verrouille que lorsque toutes ses lignes ont une
// correspondance et que le solde attendu (ouverture + mouvements) concorde
// exactement avec le solde de clôture déclaré — le rapprochement partiel
// reste possible (le relevé demeure 'open'), mais le verrouillage exige un
// rapprochement complet et exact.
async function lockStatement(db, organisationId, statementId, lockedBy) {
  const summary = await getReconciliationSummary(db, organisationId, statementId);
  if (summary.statement.status === "locked") return { duplicate: true, statement: summary.statement };
  if (!summary.fullyReconciled) {
    throw conflict("Le relevé ne peut être verrouillé : des lignes ne sont pas rapprochées ou le solde de clôture ne concorde pas.");
  }

  const { rows } = await db.query(
    `UPDATE bank_statements SET status='locked', locked_at=NOW(), locked_by=$3 WHERE organisation_id=$1 AND id=$2 RETURNING *`,
    [organisationId, statementId, lockedBy || null],
  );
  return { duplicate: false, statement: rows[0] };
}

module.exports = {
  createStatement,
  getStatement,
  listStatements,
  addStatementLines,
  listStatementLines,
  matchLine,
  unmatchLine,
  getReconciliationSummary,
  lockStatement,
};
