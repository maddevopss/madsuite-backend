const { recordPostedEntry } = require("./accounting-sync.service");

function toMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

function calculateStraightLineMonthlyDepreciation(asset) {
  const depreciableBase = toMoney(Number(asset.acquisition_cost) - Number(asset.residual_value || 0));
  if (depreciableBase < 0) throw new Error("La valeur résiduelle ne peut pas dépasser le coût d'acquisition.");
  if (!Number.isInteger(Number(asset.useful_life_months)) || Number(asset.useful_life_months) <= 0) {
    throw new Error("La durée de vie utile doit être un nombre de mois positif.");
  }
  return toMoney(depreciableBase / Number(asset.useful_life_months));
}

async function registerAsset(db, organisationId, payload) {
  const monthlyDepreciation = calculateStraightLineMonthlyDepreciation({
    acquisition_cost: payload.acquisitionCost,
    residual_value: payload.residualValue,
    useful_life_months: payload.usefulLifeMonths,
  });
  const { rows } = await db.query(
    `INSERT INTO accounting_fixed_assets
      (organisation_id, asset_number, name, description, acquisition_date, in_service_date,
       acquisition_cost, residual_value, useful_life_months, depreciation_method,
       asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id,
       status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'straight_line',$10,$11,$12,$13,$14)
     RETURNING *, $15::numeric AS monthly_depreciation`,
    [organisationId, payload.assetNumber, payload.name, payload.description || null,
      payload.acquisitionDate, payload.inServiceDate, payload.acquisitionCost,
      payload.residualValue || 0, payload.usefulLifeMonths, payload.assetAccountId,
      payload.accumulatedDepreciationAccountId, payload.depreciationExpenseAccountId,
      payload.status || "active", payload.metadata || {}, monthlyDepreciation],
  );
  return rows[0];
}

async function listFixedAssets(db, organisationId) {
  const { rows } = await db.query(
    `SELECT * FROM accounting_fixed_assets WHERE organisation_id=$1 ORDER BY asset_number`,
    [organisationId],
  );
  return rows;
}

async function getFixedAsset(db, organisationId, assetId) {
  const { rows } = await db.query(
    `SELECT * FROM accounting_fixed_assets WHERE organisation_id=$1 AND id=$2`,
    [organisationId, assetId],
  );
  return rows[0] || null;
}

// L'amortissement cumulé n'est jamais stocké comme un compteur sur l'actif
// (qui pourrait diverger silencieusement) : il est recalculé à chaque
// exécution à partir des lignes des exécutions déjà publiées — la même
// discipline "journal de mouvements, jamais de vérité parallèle" que le
// reste du moteur comptable.
async function loadDepreciableAssets(db, organisationId, runDate) {
  const { rows } = await db.query(
    `SELECT fa.*,
            COALESCE((
              SELECT SUM(dl.depreciation_amount)
              FROM accounting_depreciation_lines dl
              JOIN accounting_depreciation_runs dr
                ON dr.id = dl.run_id AND dr.organisation_id = dl.organisation_id
              WHERE dl.organisation_id = fa.organisation_id
                AND dl.fixed_asset_id = fa.id
                AND dr.status = 'posted'
            ), 0)::numeric AS prior_accumulated
     FROM accounting_fixed_assets fa
     WHERE fa.organisation_id = $1
       AND fa.status = 'active'
       AND fa.in_service_date <= $2::date
     ORDER BY fa.asset_number`,
    [organisationId, runDate],
  );
  return rows;
}

// Exécute et publie un lot d'amortissement pour une date donnée : calcule la
// charge du mois pour chaque actif encore non entièrement amorti, plafonnée
// pour ne jamais faire descendre la valeur nette comptable sous la valeur
// résiduelle, puis publie une écriture équilibrée (charge au débit,
// amortissement cumulé au crédit) via le même moteur que les autres
// automatisations comptables (recordPostedEntry).
async function runDepreciation(db, organisationId, { runDate, periodId, idempotencyKey, createdBy }) {
  if (!runDate) throw badRequest("La date d'exécution est obligatoire.");
  if (!validIdempotency(idempotencyKey)) throw badRequest("Une clé d'idempotence valide est obligatoire.");

  const existing = await db.query(
    `SELECT * FROM accounting_depreciation_runs WHERE organisation_id=$1 AND idempotency_key=$2`,
    [organisationId, idempotencyKey],
  );
  if (existing.rows[0]) {
    return { duplicate: true, run: existing.rows[0] };
  }

  const assets = await loadDepreciableAssets(db, organisationId, runDate);
  const lines = [];
  for (const asset of assets) {
    const monthly = calculateStraightLineMonthlyDepreciation(asset);
    const depreciableBase = toMoney(Number(asset.acquisition_cost) - Number(asset.residual_value || 0));
    const priorAccumulated = toMoney(asset.prior_accumulated);
    const remaining = toMoney(depreciableBase - priorAccumulated);
    if (remaining <= 0) continue;

    const amount = Math.min(monthly, remaining);
    const accumulated = toMoney(priorAccumulated + amount);
    const netBookValue = toMoney(Number(asset.acquisition_cost) - accumulated);
    lines.push({ asset, amount, accumulated, netBookValue });
  }

  if (!lines.length) {
    throw conflict("Aucun actif à amortir pour cette date : soit aucun actif en service, soit tous déjà entièrement amortis.");
  }

  const runResult = await db.query(
    `INSERT INTO accounting_depreciation_runs
      (organisation_id, period_id, run_date, status, idempotency_key, created_by)
     VALUES ($1,$2,$3,'draft',$4,$5)
     RETURNING *`,
    [organisationId, periodId || null, runDate, idempotencyKey, createdBy || null],
  );
  const run = runResult.rows[0];

  for (const line of lines) {
    await db.query(
      `INSERT INTO accounting_depreciation_lines
        (organisation_id, run_id, fixed_asset_id, depreciation_amount, accumulated_amount, net_book_value, calculation_trace)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        organisationId,
        run.id,
        line.asset.id,
        line.amount,
        line.accumulated,
        line.netBookValue,
        JSON.stringify({
          method: "straight_line",
          acquisitionCost: Number(line.asset.acquisition_cost),
          residualValue: Number(line.asset.residual_value),
          usefulLifeMonths: Number(line.asset.useful_life_months),
          priorAccumulated: Number(line.asset.prior_accumulated),
          runDate,
        }),
      ],
    );
  }

  const entryLines = [];
  const totals = { depreciation: 0, assetCount: lines.length };
  for (const line of lines) {
    entryLines.push({
      accountId: line.asset.depreciation_expense_account_id,
      description: `Amortissement — ${line.asset.name}`,
      debit: line.amount,
      credit: 0,
    });
    entryLines.push({
      accountId: line.asset.accumulated_depreciation_account_id,
      description: `Amortissement cumulé — ${line.asset.name}`,
      debit: 0,
      credit: line.amount,
    });
    totals.depreciation = toMoney(totals.depreciation + line.amount);
  }

  const posted = await recordPostedEntry(db, {
    organisationId,
    userId: createdBy,
    journalCode: "GEN",
    journalName: "Journal général",
    journalType: "general",
    entryNumber: `AMO-${run.id}`,
    entryDate: runDate,
    description: `Amortissement du ${runDate} (${lines.length} actif${lines.length > 1 ? "s" : ""})`,
    sourceType: "fixed_asset_depreciation_run",
    sourceId: run.id,
    lines: entryLines,
  });

  const updated = await db.query(
    `UPDATE accounting_depreciation_runs
     SET status='posted', accounting_entry_id=$3, totals=$4
     WHERE organisation_id=$1 AND id=$2
     RETURNING *`,
    [organisationId, run.id, posted.entryId, JSON.stringify(totals)],
  );

  return { duplicate: false, run: updated.rows[0], entryId: posted.entryId, totals };
}

module.exports = {
  calculateStraightLineMonthlyDepreciation,
  registerAsset,
  listFixedAssets,
  getFixedAsset,
  runDepreciation,
};
