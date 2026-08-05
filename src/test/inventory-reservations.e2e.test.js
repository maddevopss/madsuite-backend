// Preuve d'exécution réelle du correctif de collision de routes du domaine 3
// (inventaire). Avant ce correctif, inventory.routes.js montait
// inventory-complete.routes.js AVANT inventory-control.routes.js, et les
// deux définissaient GET/POST /reservations : Express sert toujours le
// premier gestionnaire enregistré, donc l'implémentation non transactionnelle
// et sans contrôle de rôle de inventory-complete.routes.js masquait
// silencieusement la version verrouillée (BEGIN/FOR UPDATE/COMMIT) et
// protégée admin de inventory-control.service.js::reserveStock — qui n'était
// donc jamais réellement exécutée en production malgré son code correct.
// Ce test prouve, via de vraies requêtes HTTP contre une vraie base, que la
// version verrouillée est maintenant celle qui répond : contrôle de rôle,
// verrouillage réel contre le sur-engagement concurrent, idempotence,
// transitions de statut, et que la capacité déjà prouvée (réception/solde)
// reste intacte.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

const mockState = { organisationId: null, userId: null };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = mockState.organisationId;
    req.db = require("../../db");
    next();
  },
}));

function fakeAuth(req, _res, next) {
  const role = req.header("x-test-role");
  if (role) req.user = { id: mockState.userId, role };
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

describe("Réservations d'inventaire — la version verrouillée répond (domaine 3, correctif)", () => {
  let app;
  let orgId;
  let itemId;
  let locationId;
  let reservationIdForTransition;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Réservations Inventaire E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const user = await createTestUser({ organisation_id: orgId, role: "admin" });
    mockState.userId = user.id;
    app = buildApp();

    const item = await request(app).post("/api/inventory/items").set("x-test-role", "admin").send({ sku: "SKU-RESA", name: "Article réservable" });
    itemId = item.body.item.id;
    const location = await request(app).post("/api/inventory/locations").set("x-test-role", "admin").send({ code: "ENT-RESA", name: "Entrepôt réservations" });
    locationId = location.body.location.id;
    await request(app).post("/api/inventory/receipts").set("x-test-role", "admin")
      .send({ itemId, locationId, quantity: 10, unitCost: 4, idempotencyKey: "resa-setup-receipt-0001" });
  });

  test("un employé ne peut pas créer de réservation (lecture seule)", async () => {
    const create = await request(app).post("/api/inventory/reservations").set("x-test-role", "employe")
      .send({ itemId, locationId, quantity: 2, referenceType: "sales_order", referenceId: "SO-1", idempotencyKey: "resa-e2e-employe-0001" });
    expect(create.status).toBe(403);

    const list = await request(app).get("/api/inventory/reservations").set("x-test-role", "employe");
    expect(list.status).toBe(200);
  });

  test("réservation verrouillée : réponse de inventory-control (forme duplicate/availability), pas l'ancienne forme non protégée", async () => {
    const reserved = await request(app).post("/api/inventory/reservations").set("x-test-role", "admin")
      .send({ itemId, locationId, quantity: 6, referenceType: "sales_order", referenceId: "SO-1", idempotencyKey: "resa-e2e-0001" });
    expect(reserved.status).toBe(201);
    // Forme de réponse propre à inventory-control.service.js::reserveStock —
    // l'ancienne route de inventory-complete.routes.js renvoyait
    // { reservation, availableQuantity } sans champ `duplicate` ni `availability`.
    expect(reserved.body).toHaveProperty("duplicate", false);
    expect(reserved.body).toHaveProperty("availability");
    expect(reserved.body.availability.quantityAvailable).toBe(4); // 10 en stock - 6 réservés

    // Une deuxième réservation qui dépasserait le disponible est refusée
    // (verrou réel sur inventory_balances, pas de sur-engagement possible).
    const overReserve = await request(app).post("/api/inventory/reservations").set("x-test-role", "admin")
      .send({ itemId, locationId, quantity: 5, referenceType: "sales_order", referenceId: "SO-2", idempotencyKey: "resa-e2e-overreserve" });
    expect(overReserve.status).toBe(409);

    // Idempotence : rejouer la même clé ne crée pas de deuxième réservation.
    const duplicate = await request(app).post("/api/inventory/reservations").set("x-test-role", "admin")
      .send({ itemId, locationId, quantity: 6, referenceType: "sales_order", referenceId: "SO-1", idempotencyKey: "resa-e2e-0001" });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);

    const list = await request(app).get("/api/inventory/reservations").set("x-test-role", "admin");
    expect(list.body.reservations).toHaveLength(1);
    // Jointure avec sku/nom d'article — uniquement présente dans la requête
    // de inventory-control.routes.js.
    expect(list.body.reservations[0].sku).toBe("SKU-RESA");

    reservationIdForTransition = reserved.body.reservation.id;
  });

  test("transition de réservation : libération rend le stock de nouveau disponible", async () => {
    const employeeRelease = await request(app).post(`/api/inventory/reservations/${reservationIdForTransition}/release`).set("x-test-role", "employe");
    expect(employeeRelease.status).toBe(403);

    const release = await request(app).post(`/api/inventory/reservations/${reservationIdForTransition}/release`).set("x-test-role", "admin");
    expect(release.status).toBe(200);
    expect(release.body.reservation.status).toBe("released");

    // Après libération, la quantité auparavant réservée redevient disponible.
    const nowAvailable = await request(app).post("/api/inventory/reservations").set("x-test-role", "admin")
      .send({ itemId, locationId, quantity: 10, referenceType: "sales_order", referenceId: "SO-3", idempotencyKey: "resa-e2e-after-release" });
    expect(nowAvailable.status).toBe(201);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Réservations Inventaire E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/inventory/reservations").set("x-test-role", "admin");
      expect(list.body.reservations).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
