// Preuve d'exécution réelle du domaine 3 (inventaire), premier micro-bloc.
// Cartographie préalable : postInventoryTransaction (réception, sortie,
// ajustement, transfert) est la seule capacité du domaine réellement montée
// sur des routes actives sans conflit de schéma ni de route en double
// (contrairement aux réservations et aux comptages, qui ont des routes
// dupliquées entre inventory-complete.routes.js et
// inventory-control.routes.js), et c'est la brique dont toutes les autres
// dépendraient en aval. Pourtant aucun test ne l'exécute contre une vraie
// base — seulement un test avec `db.pool` entièrement mocké. Ce test exécute
// le cycle complet via de vraies requêtes HTTP contre une vraie base :
// coût moyen pondéré au fil des réceptions/sorties/ajustements/transferts,
// écritures comptables réellement publiées et équilibrées, idempotence,
// refus de stock négatif, permissions par rôle, isolation multi-org.
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

describe("Cycle d'inventaire complet — réception, sortie, ajustement, transfert (domaine 3)", () => {
  let app;
  let orgId;
  let itemId;
  let locationAId;
  let locationBId;
  let locationCId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Inventaire E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    app = buildApp();
  });

  test("un employé ne peut pas créer d'article ni poster de transaction (lecture seule)", async () => {
    const createItem = await request(app).post("/api/inventory/items").set("x-test-role", "employe").send({ sku: "SKU-1", name: "Widget" });
    expect(createItem.status).toBe(403);

    const list = await request(app).get("/api/inventory/items").set("x-test-role", "employe");
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
  });

  test("créer un article et deux emplacements", async () => {
    const item = await request(app).post("/api/inventory/items").set("x-test-role", "admin").send({ sku: "SKU-WIDGET", name: "Widget", unit: "unité" });
    expect(item.status).toBe(201);
    itemId = item.body.item.id;

    const locA = await request(app).post("/api/inventory/locations").set("x-test-role", "admin").send({ code: "ENT-A", name: "Entrepôt A" });
    const locB = await request(app).post("/api/inventory/locations").set("x-test-role", "admin").send({ code: "ENT-B", name: "Entrepôt B" });
    expect(locA.status).toBe(201);
    expect(locB.status).toBe(201);
    locationAId = locA.body.location.id;
    locationCId = locB.body.location.id;
  });

  test("réception : coût moyen pondéré recalculé sur deux réceptions, écriture comptable équilibrée", async () => {
    const employeeReceipt = await request(app).post("/api/inventory/receipts").set("x-test-role", "employe")
      .send({ itemId, locationId: locationAId, quantity: 10, unitCost: 5, idempotencyKey: "inv-receipt-e2e-0001" });
    expect(employeeReceipt.status).toBe(403);

    const receipt1 = await request(app).post("/api/inventory/receipts").set("x-test-role", "admin")
      .send({ itemId, locationId: locationAId, quantity: 10, unitCost: 5, idempotencyKey: "inv-receipt-e2e-0001" });
    expect(receipt1.status).toBe(201);
    const totals1 = await entryTotals(receipt1.body.inventoryTransaction.accounting_entry_id);
    expect(totals1.debit).toBeCloseTo(totals1.credit, 2);
    expect(totals1.debit).toBeCloseTo(50, 2);

    let balance = await getBalance(app, itemId, locationAId);
    expect(Number(balance.quantity)).toBe(10);
    expect(Number(balance.average_cost)).toBe(5);

    const receipt2 = await request(app).post("/api/inventory/receipts").set("x-test-role", "admin")
      .send({ itemId, locationId: locationAId, quantity: 10, unitCost: 7, idempotencyKey: "inv-receipt-e2e-0002" });
    expect(receipt2.status).toBe(201);

    balance = await getBalance(app, itemId, locationAId);
    expect(Number(balance.quantity)).toBe(20);
    expect(Number(balance.average_cost)).toBe(6); // (10*5 + 10*7) / 20

    // Réceptionner deux fois avec la même clé d'idempotence est un no-op.
    const duplicateReceipt = await request(app).post("/api/inventory/receipts").set("x-test-role", "admin")
      .send({ itemId, locationId: locationAId, quantity: 10, unitCost: 7, idempotencyKey: "inv-receipt-e2e-0002" });
    expect(duplicateReceipt.status).toBe(200);
    expect(duplicateReceipt.body.duplicate).toBe(true);
    balance = await getBalance(app, itemId, locationAId);
    expect(Number(balance.quantity)).toBe(20);
  });

  test("sortie : consomme au coût moyen courant, écriture comptable au compte de charge", async () => {
    const issue = await request(app).post("/api/inventory/issues").set("x-test-role", "admin")
      .send({ itemId, locationId: locationAId, quantity: 5, idempotencyKey: "inv-issue-e2e-0001" });
    expect(issue.status).toBe(201);
    expect(Number(issue.body.inventoryTransaction.unit_cost)).toBe(6);
    expect(Number(issue.body.inventoryTransaction.total_cost)).toBe(30);

    const totals = await entryTotals(issue.body.inventoryTransaction.accounting_entry_id);
    expect(totals.debit).toBeCloseTo(totals.credit, 2);
    expect(totals.debit).toBeCloseTo(30, 2);

    const balance = await getBalance(app, itemId, locationAId);
    expect(Number(balance.quantity)).toBe(15);
    expect(Number(balance.average_cost)).toBe(6); // coût moyen inchangé par une sortie

    // Une sortie qui dépasserait le solde disponible est refusée.
    const overIssue = await request(app).post("/api/inventory/issues").set("x-test-role", "admin")
      .send({ itemId, locationId: locationAId, quantity: 1000, idempotencyKey: "inv-issue-e2e-overissue" });
    expect(overIssue.status).toBe(409);
  });

  test("ajustement : diminution au coût courant, augmentation qui déplace le coût moyen", async () => {
    const decrease = await request(app).post("/api/inventory/adjustments").set("x-test-role", "admin")
      .send({ itemId, locationId: locationAId, quantity: 3, direction: "decrease", reason: "Bris constaté à l'inventaire", idempotencyKey: "inv-adj-e2e-0001" });
    expect(decrease.status).toBe(201);
    let balance = await getBalance(app, itemId, locationAId);
    expect(Number(balance.quantity)).toBe(12);
    expect(Number(balance.average_cost)).toBe(6);
    const decreaseTotals = await entryTotals(decrease.body.inventoryTransaction.accounting_entry_id);
    expect(decreaseTotals.debit).toBeCloseTo(18, 2); // 3 * 6

    const increase = await request(app).post("/api/inventory/adjustments").set("x-test-role", "admin")
      .send({ itemId, locationId: locationAId, quantity: 4, direction: "increase", unitCost: 8, reason: "Article retrouvé lors du comptage", idempotencyKey: "inv-adj-e2e-0002" });
    expect(increase.status).toBe(201);
    balance = await getBalance(app, itemId, locationAId);
    expect(Number(balance.quantity)).toBe(16);
    expect(Number(balance.average_cost)).toBe(6.5); // (12*6 + 4*8) / 16
    const increaseTotals = await entryTotals(increase.body.inventoryTransaction.accounting_entry_id);
    expect(increaseTotals.debit).toBeCloseTo(32, 2); // 4 * 8

    // La raison est obligatoire pour un ajustement.
    const noReason = await request(app).post("/api/inventory/adjustments").set("x-test-role", "admin")
      .send({ itemId, locationId: locationAId, quantity: 1, direction: "decrease", idempotencyKey: "inv-adj-e2e-noreason" });
    expect(noReason.status).toBe(400);
  });

  test("transfert : déplace la quantité au coût courant sans effet comptable, aucun impact sur le compte de charge", async () => {
    const transfer = await request(app).post("/api/inventory/transfers").set("x-test-role", "admin")
      .send({ itemId, locationId: locationAId, destinationLocationId: locationCId, quantity: 5, idempotencyKey: "inv-transfer-e2e-0001" });
    expect(transfer.status).toBe(201);
    expect(transfer.body.accounting.skipped).toBe(true);

    const sourceBalance = await getBalance(app, itemId, locationAId);
    expect(Number(sourceBalance.quantity)).toBe(11);
    expect(Number(sourceBalance.average_cost)).toBe(6.5);

    const destinationBalance = await getBalance(app, itemId, locationCId);
    expect(Number(destinationBalance.quantity)).toBe(5);
    expect(Number(destinationBalance.average_cost)).toBe(6.5);

    // Transférer vers le même emplacement est refusé.
    const sameLocation = await request(app).post("/api/inventory/transfers").set("x-test-role", "admin")
      .send({ itemId, locationId: locationAId, destinationLocationId: locationAId, quantity: 1, idempotencyKey: "inv-transfer-e2e-sameloc" });
    expect(sameLocation.status).toBe(400);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Inventaire E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const items = await request(app).get("/api/inventory/items").set("x-test-role", "admin");
      expect(items.body.items).toEqual([]);

      const balances = await request(app).get("/api/inventory/balances").set("x-test-role", "admin");
      expect(balances.body.balances).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
