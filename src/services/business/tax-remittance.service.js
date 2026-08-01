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

const FREQUENCIES = new Set(["monthly", "quarterly", "annual"]);

async function createTaxFilingPeriod(db, organisationId, payload) {
  const frequency = String(payload?.frequency || "");
  const { periodStart, periodEnd } = payload || {};
  if (!FREQUENCIES.has(frequency)) throw badRequest("La fréquence doit être 'monthly', 'quarterly' ou 'annual'.");
  if (!periodStart || !periodEnd) throw badRequest("La période fiscale est obligatoire.");
  if (periodStart > periodEnd) throw badRequest("La date de début doit précéder la date de fin.");

  const overlap = await db.query(
    `SELECT id FROM tax_filing_periods
     WHERE organisation_id=$1 AND NOT (period_end < $2::date OR period_start > $3::date)
     LIMIT 1`,
    [organisationId, periodStart, periodEnd],
  );
  if (overlap.rowCount) throw conflict("Cette période fiscale chevauche une période fiscale existante.");

  const { rows } = await db.query(
    `INSERT INTO tax_filing_periods (organisation_id, frequency, period_start, period_end, created_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [organisationId, frequency, periodStart, periodEnd, payload.createdBy || null],
  );
  return rows[0];
}

async function getTaxFilingPeriod(db, organisationId, periodId) {
  const { rows } = await db.query(`SELECT * FROM tax_filing_periods WHERE organisation_id=$1 AND id=$2`, [organisationId, periodId]);
  return rows[0] || null;
}

async function listTaxFilingPeriods(db, organisationId) {
  const { rows } = await db.query(`SELECT * FROM tax_filing_periods WHERE organisation_id=$1 ORDER BY period_start DESC`, [organisationId]);
  return rows;
}

// Agrège, pour chaque profil de taxe, les montants réellement comptabilisés
// sur son compte associé pendant la période : le crédit net pour les taxes
// perçues ('collected', comptes de passif — la taxe collectée sur une vente
// crédite le compte), le débit net pour les taxes récupérables
// ('recoverable', comptes d'actif — la taxe payée sur un achat débite le
// compte). Inclut 'reversed' comme 'posted' (même convention que le grand
// livre) : une écriture renversée reste dans l'historique, sa contrepassation
// neutralise son effet sur le total sans qu'il faille l'exclure.
async function computeTaxRemittanceReport(db, organisationId, periodStart, periodEnd) {
  // Le filtre de date/statut doit s'appliquer AVANT la jointure au compte du
  // profil de taxe : une sous-requête pré-filtrée évite qu'une ligne d'une
  // écriture hors de la période ne reste comptée simplement parce qu'un
  // LEFT JOIN séparé sur les dates laisse la ligne elle-même déjà rattachée.
  const { rows } = await db.query(
    `SELECT tc.id AS tax_code_id, tc.code, tc.name, tc.tax_type, tc.rate,
            COALESCE(SUM(CASE WHEN tc.tax_type='collected' THEN m.credit - m.debit ELSE 0 END), 0)::numeric AS collected_amount,
            COALESCE(SUM(CASE WHEN tc.tax_type='recoverable' THEN m.debit - m.credit ELSE 0 END), 0)::numeric AS recoverable_amount
     FROM tax_codes tc
     LEFT JOIN (
       SELECT l.account_id, l.debit, l.credit
       FROM accounting_entry_lines l
       JOIN accounting_entries e ON e.id = l.entry_id AND e.organisation_id = l.organisation_id
       WHERE l.organisation_id = $1
         AND e.status IN ('posted', 'reversed')
         AND e.entry_date >= $2::date AND e.entry_date <= $3::date
     ) m ON m.account_id = tc.account_id
     WHERE tc.organisation_id = $1
     GROUP BY tc.id, tc.code, tc.name, tc.tax_type, tc.rate
     ORDER BY tc.code`,
    [organisationId, periodStart, periodEnd],
  );

  const byCode = rows.map((row) => ({
    taxCodeId: row.tax_code_id,
    code: row.code,
    name: row.name,
    taxType: row.tax_type,
    rate: Number(row.rate),
    collectedAmount: toMoney(row.collected_amount),
    recoverableAmount: toMoney(row.recoverable_amount),
  }));

  const totalCollected = toMoney(byCode.reduce((sum, row) => sum + row.collectedAmount, 0));
  const totalRecoverable = toMoney(byCode.reduce((sum, row) => sum + row.recoverableAmount, 0));
  const netAmount = toMoney(totalCollected - totalRecoverable);

  return {
    periodStart,
    periodEnd,
    byCode,
    totalCollected,
    totalRecoverable,
    netAmount,
    owesGovernment: netAmount > 0,
  };
}

async function getTaxRemittanceReport(db, organisationId, periodId) {
  const period = await getTaxFilingPeriod(db, organisationId, periodId);
  if (!period) throw notFound("Période fiscale introuvable.");

  if (period.status === "filed") {
    return { period, report: { periodStart: period.period_start, periodEnd: period.period_end, ...period.summary, netAmount: Number(period.net_amount) } };
  }

  const report = await computeTaxRemittanceReport(db, organisationId, period.period_start, period.period_end);
  return { period, report };
}

// Dépose la période : fige le rapport calculé en instantané (summary +
// net_amount) et verrouille son statut à 'filed'. Une fois déposée, la
// période n'est plus jamais recalculée — un dépôt répété retourne
// l'instantané déjà figé, insensible aux écritures publiées après coup
// (même principe que le verrouillage d'une période comptable ou d'un
// relevé bancaire réconcilié).
async function fileTaxPeriod(db, organisationId, periodId, filedBy) {
  const period = await getTaxFilingPeriod(db, organisationId, periodId);
  if (!period) throw notFound("Période fiscale introuvable.");
  if (period.status === "filed") return { duplicate: true, period };

  const report = await computeTaxRemittanceReport(db, organisationId, period.period_start, period.period_end);
  const summary = { byCode: report.byCode, totalCollected: report.totalCollected, totalRecoverable: report.totalRecoverable, owesGovernment: report.owesGovernment };

  const { rows } = await db.query(
    `UPDATE tax_filing_periods
     SET status='filed', net_amount=$3, summary=$4, filed_at=NOW(), filed_by=$5
     WHERE organisation_id=$1 AND id=$2
     RETURNING *`,
    [organisationId, periodId, report.netAmount, JSON.stringify(summary), filedBy || null],
  );
  return { duplicate: false, period: rows[0], report };
}

module.exports = {
  createTaxFilingPeriod,
  getTaxFilingPeriod,
  listTaxFilingPeriods,
  getTaxRemittanceReport,
  fileTaxPeriod,
};
