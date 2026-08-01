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

async function loadAccumulatedDepreciation(db, organisationId, assetId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(dl.depreciation_amount), 0)::numeric AS accumulated
     FROM accounting_depreciation_lines dl
     JOIN accounting_depreciation_runs dr
       ON dr.id = dl.run_id AND dr.organisation_id = dl.organisation_id
     WHERE dl.organisation_id = $1 AND dl.fixed_asset_id = $2 AND dr.status = 'posted'`,
    [organisationId, assetId],
  );
  return toMoney(rows[0].accumulated);
}

// Cède un actif immobilisé : sort son coût d'acquisition et son
// amortissement cumulé (calculé à la date de cession, avec la même
// discipline "recalculé depuis les lots publiés" que runDepreciation),
// comptabilise le produit de cession le cas échéant, et publie la
// différence comme gain ou perte sur cession. L'écriture reste équilibrée
// quel que soit le signe du gain/perte :
//   débit  = amortissement cumulé + produit de cession + perte (le cas échéant)
//   crédit = coût d'acquisition + gain (le cas échéant)
// Un actif ne peut être cédé qu'une seule fois ; une deuxième tentative sur
// un actif déjà 'disposed' retourne l'écriture déjà publiée sans rien
// republier (recordPostedEntry est lui-même idempotent par source).
async function disposeAsset(db, organisationId, assetId, {
  disposalDate,
  disposalProceeds = 0,
  proceedsAccountId,
  gainLossAccountId,
  createdBy,
}) {
  if (!disposalDate) throw badRequest("La date de cession est obligatoire.");
  const proceeds = toMoney(disposalProceeds || 0);
  if (proceeds < 0) throw badRequest("Le produit de cession ne peut pas être négatif.");

  const asset = await getFixedAsset(db, organisationId, assetId);
  if (!asset) throw Object.assign(new Error("Immobilisation introuvable."), { statusCode: 404 });

  if (asset.status === "disposed") {
    const existingEntry = await db.query(
      `SELECT id FROM accounting_entries WHERE organisation_id=$1 AND source_type='fixed_asset_disposal' AND source_id=$2 AND status <> 'reversed'`,
      [organisationId, String(assetId)],
    );
    return { duplicate: true, asset, entryId: existingEntry.rows[0]?.id || null };
  }
  if (asset.status !== "active") {
    throw conflict("Seul un actif actif peut être cédé.");
  }

  const accumulated = await loadAccumulatedDepreciation(db, organisationId, assetId);
  const netBookValue = toMoney(Number(asset.acquisition_cost) - accumulated);
  const gainLoss = toMoney(proceeds - netBookValue);

  if (proceeds > 0 && !proceedsAccountId) {
    throw badRequest("Le compte de réception du produit de cession est obligatoire lorsqu'un produit est déclaré.");
  }
  if (gainLoss !== 0 && !gainLossAccountId) {
    throw badRequest("Le compte de gain ou perte sur cession est obligatoire.");
  }

  const entryLines = [
    { accountId: asset.accumulated_depreciation_account_id, description: `Sortie de l'amortissement cumulé — ${asset.name}`, debit: accumulated, credit: 0 },
    { accountId: asset.asset_account_id, description: `Sortie de l'actif au coût — ${asset.name}`, debit: 0, credit: Number(asset.acquisition_cost) },
  ];
  if (proceeds > 0) {
    entryLines.push({ accountId: proceedsAccountId, description: `Produit de cession — ${asset.name}`, debit: proceeds, credit: 0 });
  }
  if (gainLoss > 0) {
    entryLines.push({ accountId: gainLossAccountId, description: `Gain sur cession — ${asset.name}`, debit: 0, credit: gainLoss });
  } else if (gainLoss < 0) {
    entryLines.push({ accountId: gainLossAccountId, description: `Perte sur cession — ${asset.name}`, debit: -gainLoss, credit: 0 });
  }

  const posted = await recordPostedEntry(db, {
    organisationId,
    userId: createdBy,
    journalCode: "GEN",
    journalName: "Journal général",
    journalType: "general",
    entryNumber: `CES-${asset.id}`,
    entryDate: disposalDate,
    description: `Cession de l'immobilisation ${asset.asset_number} — ${asset.name}`,
    sourceType: "fixed_asset_disposal",
    sourceId: String(assetId),
    lines: entryLines,
  });

  const updated = await db.query(
    `UPDATE accounting_fixed_assets
     SET status='disposed', disposed_at=$3, disposal_proceeds=$4
     WHERE organisation_id=$1 AND id=$2
     RETURNING *`,
    [organisationId, assetId, disposalDate, proceeds],
  );

  return { duplicate: false, asset: updated.rows[0], entryId: posted.entryId, netBookValue, accumulated, gainLoss };
}

module.exports = {
  calculateStraightLineMonthlyDepreciation,
  registerAsset,
  listFixedAssets,
  getFixedAsset,
  runDepreciation,
  disposeAsset,
};
