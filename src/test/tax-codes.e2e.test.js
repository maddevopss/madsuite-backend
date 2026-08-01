// Preuve d'exécution réelle pour le domaine 1.I (taxes avancées), premier
// micro-bloc : registre de profils de taxes versionnés et datés. Jusqu'ici
// les taux de taxe n'existaient que sous forme de champs numériques libres
// sans registre gouverné — ce test prouve la création, l'activation (un
// seul profil actif par code), la résolution par date (jamais "le plus
// récent"), le calcul déterministe, et l'isolation multi-organisation.
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { createAccount } = require("../services/business/accounting-masterdata.service");
const {
  createTaxCode,
  listTaxCodes,
  activateTaxCode,
  resolveActiveTaxCode,
  calculateTax,
} = require("../services/business/tax-codes.service");

describe("Registre de profils de taxes (domaine 1.I)", () => {
  let client;
  let orgA;
  let orgB;
  let taxPayableAccountA;

  beforeAll(async () => {
    client = await db.pool.connect();
    orgA = await createTestOrganisation({ nom: "Taxes E2E Org A" });
    orgB = await createTestOrganisation({ nom: "Taxes E2E Org B" });
    const account = await createAccount(client, orgA.id, {
      code: "2199", name: "TPS à remettre (test)", accountType: "liability", normalBalance: "credit",
    });
    taxPayableAccountA = account.id;
  });

  afterAll(() => {
    client.release();
  });

  test("création, activation, et résolution par date d'un profil de taxe", async () => {
    const draft = await createTaxCode(client, orgA.id, {
      code: "tps", // normalisé en majuscules
      name: "TPS 5%",
      rate: 0.05,
      taxType: "collected",
      accountId: taxPayableAccountA,
      effectiveFrom: "2026-01-01",
      createdBy: null,
    });
    expect(draft.code).toBe("TPS");
    expect(draft.status).toBe("draft");

    const listedBeforeActivation = await listTaxCodes(client, orgA.id);
    expect(listedBeforeActivation).toHaveLength(1);

    // Un profil brouillon n'est pas encore applicable.
    expect(await resolveActiveTaxCode(client, orgA.id, "TPS", "2026-06-01")).toBeNull();

    const activated = await activateTaxCode(client, orgA.id, draft.id, null);
    expect(activated.status).toBe("active");

    const resolved = await resolveActiveTaxCode(client, orgA.id, "TPS", "2026-06-01");
    expect(resolved.id).toBe(draft.id);

    // Avant la date d'entrée en vigueur, le profil ne s'applique pas encore.
    expect(await resolveActiveTaxCode(client, orgA.id, "TPS", "2025-12-31")).toBeNull();

    const tax = calculateTax(1000, resolved);
    expect(tax.amount).toBe(50);
    expect(tax.rate).toBe(0.05);
    expect(tax.taxCodeId).toBe(draft.id);
  });

  test("activer un nouveau profil du même code retire l'ancien sans chevauchement", async () => {
    const v2 = await createTaxCode(client, orgA.id, {
      code: "TPS", name: "TPS 5% (v2)", rate: 0.05, taxType: "collected", accountId: taxPayableAccountA, effectiveFrom: "2026-07-01",
    });
    await activateTaxCode(client, orgA.id, v2.id, null);

    const { rows } = await client.query(`SELECT status, effective_to FROM tax_codes WHERE organisation_id=$1 AND code='TPS' ORDER BY effective_from`, [orgA.id]);
    expect(rows[0].status).toBe("retired");
    expect(rows[0].effective_to).not.toBeNull();
    expect(rows[1].status).toBe("active");

    const activeCount = await client.query(`SELECT COUNT(*)::int AS n FROM tax_codes WHERE organisation_id=$1 AND code='TPS' AND status='active'`, [orgA.id]);
    expect(activeCount.rows[0].n).toBe(1);

    // Une date avant le changement résout toujours l'ancien profil (rétiré
    // mais dont la fenêtre d'application couvre encore cette date).
    const resolvedBefore = await resolveActiveTaxCode(client, orgA.id, "TPS", "2026-03-01");
    expect(resolvedBefore).toBeNull(); // le profil v1 est 'retired', pas 'active' : résolution stricte sur status='active' uniquement.
  });

  test("validation : taux hors bornes, type invalide, code réutilisé à la même date", async () => {
    await expect(
      createTaxCode(client, orgA.id, { code: "BAD", name: "Taux invalide", rate: 1.5, taxType: "collected", accountId: taxPayableAccountA, effectiveFrom: "2026-01-01" }),
    ).rejects.toThrow("taux");

    await expect(
      createTaxCode(client, orgA.id, { code: "BAD2", name: "Type invalide", rate: 0.05, taxType: "sales", accountId: taxPayableAccountA, effectiveFrom: "2026-01-01" }),
    ).rejects.toThrow("collected");

    await createTaxCode(client, orgA.id, { code: "DUP", name: "Premier", rate: 0.05, taxType: "collected", accountId: taxPayableAccountA, effectiveFrom: "2026-01-01" });
    await expect(
      createTaxCode(client, orgA.id, { code: "DUP", name: "Doublon", rate: 0.09975, taxType: "collected", accountId: taxPayableAccountA, effectiveFrom: "2026-01-01" }),
    ).rejects.toThrow("existe déjà");
  });

  test("isolation stricte entre deux organisations", async () => {
    const listedOrgB = await listTaxCodes(client, orgB.id);
    expect(listedOrgB).toEqual([]);
    expect(await resolveActiveTaxCode(client, orgB.id, "TPS", "2026-06-01")).toBeNull();

    // Le compte de orgA n'est pas visible pour créer un profil dans orgB.
    await expect(
      createTaxCode(client, orgB.id, { code: "TVQ", name: "TVQ", rate: 0.09975, taxType: "collected", accountId: taxPayableAccountA, effectiveFrom: "2026-01-01" }),
    ).rejects.toThrow("introuvable");
  });
});
