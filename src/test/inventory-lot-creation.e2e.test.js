// Preuve d'exécution réelle de la création de lot (domaine 3), dernière
// pièce manquante du cycle de vie du lot identifiée dans #692 : il n'existait
// aucune route pour créer un lot, seuls GET /lots et POST /lots/:id/
// disposition existaient. Créer un lot est, du point de vue comptable et du
// solde, une réception d'inventaire ordinaire — la route réutilise donc
// postInventoryTransaction (déjà couverte par des tests réels, domaine 3
// micro-bloc 1) plutôt que de dupliquer la logique de solde/écriture
// comptable. Ce test prouve, via de vraies requêtes HTTP contre une vraie
// base : le solde et l'écriture comptable augmentent réellement au moment de
// la création du lot, l'idempotence (même clé → même lot, pas de double
// réception), et le refus propre (409) d'un numéro de lot dupliqué sur une
// tentative qui n'était PAS une relecture idempotente — sans perdre la trace
// du mouvement de stock déjà publié.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");

const mockState = { organisationId: null };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = mockState.organisationId;
    req.db = require("../../db");
    next();
  },
}));

function fakeAuth(req, _res, next) {
  const role = req.header("x-test-role");
  if (role) req.user = { id: 1, role };
  next();
}

const inventoryRoutes = require("../routes/business/inventory.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/inventory", inventoryRoutes);
  return app;
}

async function entryTotals(entryId) {
  const { rows } = await db.pool.query(
    "SELECT COALESCE(SUM(debit),0)::numeric AS debit, COALESCE(SUM(credit),0)::numeric AS credit FROM accounting_entry_lines WHERE entry_id=$1",
    [entryId],
  );
  return { debit: Number(rows[0].debit), credit: Number(rows[0].credit) };
}

async function getBalance(app, itemId, locationId) {
  const res = await request(app).get("/api/inventory/balances").query({ itemId, locationId }).set("x-test-role", "admin");
  return res.body.balances[0];
}

describe("Création d'un lot — réception réelle (domaine 3)", () => {
  let app;
  let orgId;
  let itemId;
  let locationId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Lot Creation E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    app = buildApp();

    const item = await request(app).post("/api/inventory/items").set("x-test-role", "admin").send({ sku: "SKU-LOT-CREATE", name: "Article reçu par lot" });
    itemId = item.body.item.id;
    const location = await request(app).post("/api/inventory/locations").set("x-test-role", "admin").send({ code: "ENT-LOT-CREATE", name: "Entrepôt lots" });
    locationId = location.body.location.id;
  });

  test("un employé ne peut pas créer de lot", async () => {
    const res = await request(app).post("/api/inventory/lots").set("x-test-role", "employe")
      .send({ itemId, locationId, lotNumber: "LOT-EMP", quantity: 5, unitCost: 10, idempotencyKey: "lot-create-e2e-employe" });
    expect(res.status).toBe(403);
  });

  test("création réelle : solde et écriture comptable augmentent, lot persisté disponible", async () => {
    const res = await request(app).post("/api/inventory/lots").set("x-test-role", "admin")
      .send({ itemId, locationId, lotNumber: "LOT-0001", quantity: 50, unitCost: 12, idempotencyKey: "lot-create-e2e-0001" });
    expect(res.status).toBe(201);
    expect(res.body.lot.status).toBe("available");
    expect(Number(res.body.lot.quantity)).toBe(50);
    expect(Number(res.body.lot.unit_cost)).toBe(12);
    expect(res.body.lot.location_id).toBe(String(locationId));

    const totals = await entryTotals(res.body.receipt.inventoryTransaction.accounting_entry_id);
    expect(totals.debit).toBeCloseTo(totals.credit, 2);
    expect(totals.debit).toBeCloseTo(600, 2); // 50 * 12

    const balance = await getBalance(app, itemId, locationId);
    expect(Number(balance.quantity)).toBe(50);
    expect(Number(balance.average_cost)).toBe(12);
  });

  test("idempotence : la même clé ne crée pas un deuxième lot ni une deuxième réception", async () => {
    const res = await request(app).post("/api/inventory/lots").set("x-test-role", "admin")
      .send({ itemId, locationId, lotNumber: "LOT-0001", quantity: 50, unitCost: 12, idempotencyKey: "lot-create-e2e-0001" });
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);

    const balance = await getBalance(app, itemId, locationId);
    expect(Number(balance.quantity)).toBe(50); // inchangé, pas de double réception

    const lots = await db.pool.query("SELECT COUNT(*)::int n FROM inventory_lots WHERE organisation_id=$1 AND lot_number='LOT-0001'", [orgId]);
    expect(lots.rows[0].n).toBe(1);
  });

  test("numéro de lot déjà utilisé (hors relecture idempotente) : 409, mais le stock reçu reste acquis", async () => {
    const res = await request(app).post("/api/inventory/lots").set("x-test-role", "admin")
      .send({ itemId, locationId, lotNumber: "LOT-0001", quantity: 5, unitCost: 20, idempotencyKey: "lot-create-e2e-conflict" });
    expect(res.status).toBe(409);

    // Le mouvement de stock a bel et bien été publié (nouvelle clé
    // d'idempotence acceptée par le moteur de transaction) même si
    // l'enregistrement du lot a échoué — jamais de perte silencieuse.
    const balance = await getBalance(app, itemId, locationId);
    expect(Number(balance.quantity)).toBe(55); // 50 + 5

    const transaction = await db.pool.query(
      "SELECT * FROM inventory_transactions WHERE organisation_id=$1 AND idempotency_key='lot-create-e2e-conflict'",
      [orgId],
    );
    expect(transaction.rows).toHaveLength(1);
  });

  test("validations : article/emplacement, numéro de lot, quantité et coût obligatoires", async () => {
    const missingItem = await request(app).post("/api/inventory/lots").set("x-test-role", "admin")
      .send({ locationId, lotNumber: "LOT-X", quantity: 1, unitCost: 1, idempotencyKey: "lot-create-e2e-missing-item" });
    expect(missingItem.status).toBe(400);

    const missingLotNumber = await request(app).post("/api/inventory/lots").set("x-test-role", "admin")
      .send({ itemId, locationId, quantity: 1, unitCost: 1, idempotencyKey: "lot-create-e2e-missing-lotnumber" });
    expect(missingLotNumber.status).toBe(400);

    const badQuantity = await request(app).post("/api/inventory/lots").set("x-test-role", "admin")
      .send({ itemId, locationId, lotNumber: "LOT-BADQTY", quantity: 0, unitCost: 1, idempotencyKey: "lot-create-e2e-badqty" });
    expect(badQuantity.status).toBe(400);

    const badCost = await request(app).post("/api/inventory/lots").set("x-test-role", "admin")
      .send({ itemId, locationId, lotNumber: "LOT-BADCOST", quantity: 1, unitCost: 0, idempotencyKey: "lot-create-e2e-badcost" });
    expect(badCost.status).toBe(400);
  });

  test("article ou emplacement introuvable renvoie 404", async () => {
    const res = await request(app).post("/api/inventory/lots").set("x-test-role", "admin")
      .send({ itemId: 999999, locationId, lotNumber: "LOT-404", quantity: 1, unitCost: 1, idempotencyKey: "lot-create-e2e-404" });
    expect(res.status).toBe(404);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Lot Creation E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/inventory/lots").set("x-test-role", "admin");
      expect(list.body.lots).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
