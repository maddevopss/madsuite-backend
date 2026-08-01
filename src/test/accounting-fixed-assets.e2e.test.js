// Preuve d'exécution réelle pour le premier micro-bloc du domaine 1.H
// (Immobilisations et amortissements) : la fondation (schéma + RLS,
// migration 20260727181000_accounting_fixed_assets.sql) existait déjà,
// mais le service ne savait qu'enregistrer un actif — aucune route HTTP,
// aucun calcul d'amortissement publié, aucun test réel. Ce test exécute
// le cycle contre une vraie base PostgreSQL : enregistrement d'un actif,
// exécution d'un lot d'amortissement publiant une écriture équilibrée,
// idempotence, plafonnement à la valeur résiduelle, exclusion d'un actif
// entièrement amorti, et isolation entre deux organisations.
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { createAccount } = require("../services/business/accounting-masterdata.service");
const {
  calculateStraightLineMonthlyDepreciation,
  registerAsset,
  listFixedAssets,
  getFixedAsset,
  runDepreciation,
} = require("../services/business/accounting-fixed-assets.service");

async function seedAssetAccounts(client, organisationId, suffix) {
  const asset = await createAccount(client, organisationId, {
    code: `15${suffix}`,
    name: `Équipement ${suffix}`,
    accountType: "asset",
    normalBalance: "debit",
  });
  const accumulated = await createAccount(client, organisationId, {
    code: `16${suffix}`,
    name: `Amortissement cumulé — Équipement ${suffix}`,
    accountType: "asset",
    normalBalance: "debit",
  });
  const expense = await createAccount(client, organisationId, {
    code: `68${suffix}`,
    name: `Charge d'amortissement ${suffix}`,
    accountType: "expense",
    normalBalance: "debit",
  });
  return { assetAccountId: asset.id, accumulatedDepreciationAccountId: accumulated.id, depreciationExpenseAccountId: expense.id };
}

describe("Immobilisations et amortissements (domaine 1.H)", () => {
  let client;
  let orgA;
  let orgB;
  let orgC;

  beforeAll(async () => {
    client = await db.pool.connect();
    orgA = await createTestOrganisation({ nom: "Immobilisations E2E Org A" });
    orgB = await createTestOrganisation({ nom: "Immobilisations E2E Org B" });
    orgC = await createTestOrganisation({ nom: "Immobilisations E2E Org C" });
  });

  afterAll(() => {
    client.release();
  });

  test("calcul d'amortissement linéaire déterministe", () => {
    expect(calculateStraightLineMonthlyDepreciation({
      acquisition_cost: 12000,
      residual_value: 1200,
      useful_life_months: 60,
    })).toBe(180);
  });

  test("enregistrement, calcul et publication d'un lot d'amortissement", async () => {
    const accounts = await seedAssetAccounts(client, orgA.id, "01");
    const asset = await registerAsset(client, orgA.id, {
      assetNumber: "EQ-E2E-001",
      name: "Camion de service",
      acquisitionDate: "2026-01-01",
      inServiceDate: "2026-01-01",
      acquisitionCost: 12000,
      residualValue: 1200,
      usefulLifeMonths: 60,
      ...accounts,
    });
    expect(asset.status).toBe("active");
    expect(Number(asset.monthly_depreciation)).toBe(180);

    const listed = await listFixedAssets(client, orgA.id);
    expect(listed.some((row) => row.id === asset.id)).toBe(true);

    const fetched = await getFixedAsset(client, orgA.id, asset.id);
    expect(fetched.asset_number).toBe("EQ-E2E-001");

    const idempotencyKey = `depr-run-e2e-${asset.id}-1`;
    const firstRun = await runDepreciation(client, orgA.id, {
      runDate: "2026-01-31",
      idempotencyKey,
      createdBy: null,
    });
    expect(firstRun.duplicate).toBe(false);
    expect(firstRun.run.status).toBe("posted");
    expect(Number(firstRun.totals.depreciation)).toBe(180);

    const entryLines = await client.query(
      "SELECT COALESCE(SUM(debit),0)::numeric AS debit, COALESCE(SUM(credit),0)::numeric AS credit FROM accounting_entry_lines WHERE entry_id=$1",
      [firstRun.entryId],
    );
    expect(Number(entryLines.rows[0].debit)).toBeCloseTo(Number(entryLines.rows[0].credit), 2);
    expect(Number(entryLines.rows[0].debit)).toBeCloseTo(180, 2);

    // Republier avec la même clé d'idempotence est un no-op : aucune
    // deuxième écriture, aucune deuxième ligne d'amortissement.
    const secondRun = await runDepreciation(client, orgA.id, {
      runDate: "2026-01-31",
      idempotencyKey,
      createdBy: null,
    });
    expect(secondRun.duplicate).toBe(true);
    expect(secondRun.run.id).toBe(firstRun.run.id);

    const linesForAsset = await client.query(
      "SELECT COUNT(*)::int AS n FROM accounting_depreciation_lines WHERE fixed_asset_id=$1",
      [asset.id],
    );
    expect(linesForAsset.rows[0].n).toBe(1);
  });

  test("l'amortissement se plafonne à la valeur résiduelle et exclut un actif entièrement amorti", async () => {
    // Organisation dédiée (orgC) : le plafonnement doit être vérifié sur le
    // total publié, qui est calculé pour TOUS les actifs actifs de
    // l'organisation — l'isoler évite toute interférence avec l'actif déjà
    // partiellement amorti du test précédent dans orgA.
    const accounts = await seedAssetAccounts(client, orgC.id, "02");
    // Actif presque entièrement amorti : 1 mois de vie utile restant pour
    // 50$ de base amortissable — le mois suivant doit être plafonné, pas
    // simplement répéter la mensualité théorique.
    const asset = await registerAsset(client, orgC.id, {
      assetNumber: "EQ-E2E-002",
      name: "Petit équipement presque amorti",
      acquisitionDate: "2020-01-01",
      inServiceDate: "2020-01-01",
      acquisitionCost: 1000,
      residualValue: 950,
      usefulLifeMonths: 1,
      ...accounts,
    });

    const run = await runDepreciation(client, orgC.id, {
      runDate: "2026-02-28",
      idempotencyKey: `depr-run-e2e-${asset.id}-cap`,
      createdBy: null,
    });
    expect(run.duplicate).toBe(false);
    expect(Number(run.totals.depreciation)).toBe(50);

    const line = await client.query(
      "SELECT net_book_value FROM accounting_depreciation_lines WHERE fixed_asset_id=$1",
      [asset.id],
    );
    expect(Number(line.rows[0].net_book_value)).toBe(950);

    // L'actif est maintenant entièrement amorti : une nouvelle exécution ne
    // doit plus le sélectionner. S'il n'y a plus aucun autre actif éligible
    // dans cette organisation pour cette date, l'exécution est refusée.
    await expect(
      runDepreciation(client, orgC.id, {
        runDate: "2026-03-31",
        idempotencyKey: `depr-run-e2e-${asset.id}-after-full`,
        createdBy: null,
      }),
    ).rejects.toThrow("Aucun actif à amortir");
  });

  test("isolation stricte entre deux organisations", async () => {
    const assetsOrgB = await listFixedAssets(client, orgB.id);
    expect(assetsOrgB).toEqual([]);

    await expect(
      runDepreciation(client, orgB.id, {
        runDate: "2026-01-31",
        idempotencyKey: "depr-run-e2e-orgb-empty",
        createdBy: null,
      }),
    ).rejects.toThrow("Aucun actif à amortir");
  });
});
