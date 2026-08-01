// Preuve d'exécution réelle pour la cession d'immobilisations (domaine
// 1.H, micro-bloc 2/2) : sortie de l'actif au coût, sortie de
// l'amortissement cumulé, comptabilisation du produit de cession et du
// gain ou de la perte, avec écriture toujours équilibrée quel que soit le
// signe du résultat, idempotence, et isolation multi-organisation.
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { createAccount } = require("../services/business/accounting-masterdata.service");
const { registerAsset, disposeAsset, runDepreciation } = require("../services/business/accounting-fixed-assets.service");

async function seedAssetAccounts(client, organisationId, suffix) {
  const asset = await createAccount(client, organisationId, {
    code: `17${suffix}`, name: `Équipement ${suffix}`, accountType: "asset", normalBalance: "debit",
  });
  const accumulated = await createAccount(client, organisationId, {
    code: `18${suffix}`, name: `Amortissement cumulé ${suffix}`, accountType: "asset", normalBalance: "debit",
  });
  const expense = await createAccount(client, organisationId, {
    code: `69${suffix}`, name: `Charge d'amortissement ${suffix}`, accountType: "expense", normalBalance: "debit",
  });
  const bank = await createAccount(client, organisationId, {
    code: `10${suffix}`, name: `Banque ${suffix}`, accountType: "asset", normalBalance: "debit",
  });
  const gainLoss = await createAccount(client, organisationId, {
    code: `48${suffix}`, name: `Gain/perte sur cession ${suffix}`, accountType: "revenue", normalBalance: "credit",
  });
  return {
    assetAccountId: asset.id,
    accumulatedDepreciationAccountId: accumulated.id,
    depreciationExpenseAccountId: expense.id,
    bankAccountId: bank.id,
    gainLossAccountId: gainLoss.id,
  };
}

async function entryTotals(client, entryId) {
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(debit),0)::numeric AS debit, COALESCE(SUM(credit),0)::numeric AS credit FROM accounting_entry_lines WHERE entry_id=$1",
    [entryId],
  );
  return { debit: Number(rows[0].debit), credit: Number(rows[0].credit) };
}

describe("Cession d'immobilisations (domaine 1.H)", () => {
  let client;
  let orgA;
  let orgB;

  beforeAll(async () => {
    client = await db.pool.connect();
    orgA = await createTestOrganisation({ nom: "Cession E2E Org A" });
    orgB = await createTestOrganisation({ nom: "Cession E2E Org B" });
  });

  afterAll(() => {
    client.release();
  });

  test("cession avec gain : écriture équilibrée et actif marqué cédé", async () => {
    const accounts = await seedAssetAccounts(client, orgA.id, "01");
    const asset = await registerAsset(client, orgA.id, {
      assetNumber: "EQ-DISP-001",
      name: "Équipement à céder avec gain",
      acquisitionDate: "2026-01-01",
      inServiceDate: "2026-01-01",
      acquisitionCost: 10000,
      residualValue: 1000,
      usefulLifeMonths: 60,
      assetAccountId: accounts.assetAccountId,
      accumulatedDepreciationAccountId: accounts.accumulatedDepreciationAccountId,
      depreciationExpenseAccountId: accounts.depreciationExpenseAccountId,
    });

    await runDepreciation(client, orgA.id, {
      runDate: "2026-01-31",
      idempotencyKey: `depr-disp-${asset.id}`,
      createdBy: null,
    });

    const result = await disposeAsset(client, orgA.id, asset.id, {
      disposalDate: "2026-02-15",
      disposalProceeds: 10500,
      proceedsAccountId: accounts.bankAccountId,
      gainLossAccountId: accounts.gainLossAccountId,
      createdBy: null,
    });

    expect(result.duplicate).toBe(false);
    expect(result.asset.status).toBe("disposed");
    expect(result.accumulated).toBe(150);
    expect(result.netBookValue).toBe(9850);
    expect(result.gainLoss).toBe(650);

    const totals = await entryTotals(client, result.entryId);
    expect(totals.debit).toBeCloseTo(totals.credit, 2);
    expect(totals.debit).toBeCloseTo(10650, 2);
  });

  test("cession avec perte : la perte est comptabilisée au débit et l'écriture reste équilibrée", async () => {
    const accounts = await seedAssetAccounts(client, orgA.id, "02");
    const asset = await registerAsset(client, orgA.id, {
      assetNumber: "EQ-DISP-002",
      name: "Équipement à céder avec perte",
      acquisitionDate: "2026-01-01",
      inServiceDate: "2026-01-01",
      acquisitionCost: 10000,
      residualValue: 1000,
      usefulLifeMonths: 60,
      assetAccountId: accounts.assetAccountId,
      accumulatedDepreciationAccountId: accounts.accumulatedDepreciationAccountId,
      depreciationExpenseAccountId: accounts.depreciationExpenseAccountId,
    });

    await runDepreciation(client, orgA.id, {
      runDate: "2026-01-31",
      idempotencyKey: `depr-disp-${asset.id}`,
      createdBy: null,
    });

    const result = await disposeAsset(client, orgA.id, asset.id, {
      disposalDate: "2026-02-15",
      disposalProceeds: 5000,
      proceedsAccountId: accounts.bankAccountId,
      gainLossAccountId: accounts.gainLossAccountId,
      createdBy: null,
    });

    expect(result.gainLoss).toBe(-4850);
    const totals = await entryTotals(client, result.entryId);
    expect(totals.debit).toBeCloseTo(totals.credit, 2);
    expect(totals.debit).toBeCloseTo(10000, 2);
  });

  test("mise au rebut sans produit de cession : perte égale à la valeur nette comptable", async () => {
    const accounts = await seedAssetAccounts(client, orgA.id, "03");
    const asset = await registerAsset(client, orgA.id, {
      assetNumber: "EQ-DISP-003",
      name: "Équipement mis au rebut",
      acquisitionDate: "2020-01-01",
      inServiceDate: "2020-01-01",
      acquisitionCost: 1000,
      residualValue: 0,
      usefulLifeMonths: 12,
      assetAccountId: accounts.assetAccountId,
      accumulatedDepreciationAccountId: accounts.accumulatedDepreciationAccountId,
      depreciationExpenseAccountId: accounts.depreciationExpenseAccountId,
    });

    // Pas d'exécution d'amortissement au préalable : valeur nette comptable = coût complet.
    const result = await disposeAsset(client, orgA.id, asset.id, {
      disposalDate: "2026-02-15",
      disposalProceeds: 0,
      gainLossAccountId: accounts.gainLossAccountId,
      createdBy: null,
    });

    expect(result.gainLoss).toBe(-1000);
    const totals = await entryTotals(client, result.entryId);
    expect(totals.debit).toBeCloseTo(totals.credit, 2);
    expect(totals.debit).toBeCloseTo(1000, 2);
  });

  test("idempotence : céder un actif déjà cédé retourne l'écriture existante sans en republier", async () => {
    const accounts = await seedAssetAccounts(client, orgA.id, "04");
    const asset = await registerAsset(client, orgA.id, {
      assetNumber: "EQ-DISP-004",
      name: "Équipement cession répétée",
      acquisitionDate: "2026-01-01",
      inServiceDate: "2026-01-01",
      acquisitionCost: 2000,
      residualValue: 0,
      usefulLifeMonths: 24,
      assetAccountId: accounts.assetAccountId,
      accumulatedDepreciationAccountId: accounts.accumulatedDepreciationAccountId,
      depreciationExpenseAccountId: accounts.depreciationExpenseAccountId,
    });

    const first = await disposeAsset(client, orgA.id, asset.id, {
      disposalDate: "2026-02-15",
      disposalProceeds: 2000,
      proceedsAccountId: accounts.bankAccountId,
      createdBy: null,
    });
    expect(first.duplicate).toBe(false);

    const second = await disposeAsset(client, orgA.id, asset.id, {
      disposalDate: "2026-02-15",
      disposalProceeds: 2000,
      proceedsAccountId: accounts.bankAccountId,
      createdBy: null,
    });
    expect(second.duplicate).toBe(true);
    expect(second.entryId).toBe(first.entryId);

    const lineCount = await client.query(
      "SELECT COUNT(*)::int AS n FROM accounting_entry_lines WHERE entry_id=$1",
      [first.entryId],
    );
    const entryCount = await client.query(
      "SELECT COUNT(*)::int AS n FROM accounting_entries WHERE organisation_id=$1 AND source_type='fixed_asset_disposal' AND source_id=$2",
      [orgA.id, String(asset.id)],
    );
    expect(entryCount.rows[0].n).toBe(1);
    expect(lineCount.rows[0].n).toBeGreaterThan(0);
  });

  test("un actif non actif (déjà cédé sous un autre statut logique) ne peut pas être cédé", async () => {
    const accounts = await seedAssetAccounts(client, orgA.id, "05");
    const asset = await registerAsset(client, orgA.id, {
      assetNumber: "EQ-DISP-005",
      name: "Équipement brouillon",
      acquisitionDate: "2026-01-01",
      inServiceDate: "2026-01-01",
      acquisitionCost: 500,
      residualValue: 0,
      usefulLifeMonths: 12,
      status: "draft",
      assetAccountId: accounts.assetAccountId,
      accumulatedDepreciationAccountId: accounts.accumulatedDepreciationAccountId,
      depreciationExpenseAccountId: accounts.depreciationExpenseAccountId,
    });

    await expect(
      disposeAsset(client, orgA.id, asset.id, { disposalDate: "2026-02-15", disposalProceeds: 0, gainLossAccountId: accounts.gainLossAccountId }),
    ).rejects.toThrow("Seul un actif actif peut être cédé.");
  });

  test("le produit de cession exige un compte de réception", async () => {
    const accounts = await seedAssetAccounts(client, orgA.id, "06");
    const asset = await registerAsset(client, orgA.id, {
      assetNumber: "EQ-DISP-006",
      name: "Équipement sans compte banque fourni",
      acquisitionDate: "2026-01-01",
      inServiceDate: "2026-01-01",
      acquisitionCost: 500,
      residualValue: 0,
      usefulLifeMonths: 12,
      assetAccountId: accounts.assetAccountId,
      accumulatedDepreciationAccountId: accounts.accumulatedDepreciationAccountId,
      depreciationExpenseAccountId: accounts.depreciationExpenseAccountId,
    });

    await expect(
      disposeAsset(client, orgA.id, asset.id, { disposalDate: "2026-02-15", disposalProceeds: 500 }),
    ).rejects.toThrow("compte de réception");
  });

  test("isolation stricte : une organisation ne peut pas céder l'actif d'une autre", async () => {
    const accounts = await seedAssetAccounts(client, orgA.id, "07");
    const asset = await registerAsset(client, orgA.id, {
      assetNumber: "EQ-DISP-007",
      name: "Équipement isolation",
      acquisitionDate: "2026-01-01",
      inServiceDate: "2026-01-01",
      acquisitionCost: 500,
      residualValue: 0,
      usefulLifeMonths: 12,
      assetAccountId: accounts.assetAccountId,
      accumulatedDepreciationAccountId: accounts.accumulatedDepreciationAccountId,
      depreciationExpenseAccountId: accounts.depreciationExpenseAccountId,
    });

    await expect(
      disposeAsset(client, orgB.id, asset.id, { disposalDate: "2026-02-15", disposalProceeds: 0, gainLossAccountId: accounts.gainLossAccountId }),
    ).rejects.toThrow("Immobilisation introuvable.");
  });
});
