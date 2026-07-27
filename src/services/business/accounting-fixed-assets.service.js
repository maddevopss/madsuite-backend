function toMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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
  const monthlyDepreciation = calculateStraightLineMonthlyDepreciation(payload);
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

module.exports = { calculateStraightLineMonthlyDepreciation, registerAsset };
