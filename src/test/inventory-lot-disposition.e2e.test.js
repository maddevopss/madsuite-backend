// Preuve d'exécution réelle du correctif de schéma de inventory_lots
// (domaine 3), suite de #690/#691. La table avait deux définitions de
// migration incompatibles : la première (200000) l'a réellement créée avec
// un vocabulaire de statut restreint (active/quarantined/expired/consumed/
// recalled) ; la seconde (222000), qui avait l'intention d'ajouter
// location_id/quantity et d'élargir le statut à available/disposed, n'a
// jamais pu s'appliquer car CREATE TABLE IF NOT EXISTS est un no-op sur une
// table déjà existante — seules quelques colonnes ont été ajoutées via
// ALTER TABLE, sans quantity ni location_id, et sans toucher la contrainte
// CHECK de statut. Résultat réel : quantity était toujours NULL, donc
// validateLotDisposition rejetait TOUTE demande de disposition avec
// inventory.lot.quantity_invalid, avant même d'atteindre la contrainte de
// statut — POST /inventory/lots/:id/disposition était totalement non
// fonctionnelle, y compris pour 'quarantined' qui était pourtant déjà
// couvert par les deux migrations.
//
// La migration 20260801_inventory_lots_schema_completion.sql complète le
// schéma (location_id, quantity, contrainte de statut élargie). Ce test
// prouve, via de vraies requêtes HTTP contre une vraie base, que la
// disposition fonctionne désormais pour 'quarantined' ET pour 'disposed' —
// le statut que la contrainte CHECK d'origine rejetait explicitement.
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

async function insertLot(organisationId, { itemId, locationId, lotNumber, status = "available", quantity = 10 }) {
  const { rows } = await db.pool.query(
    `INSERT INTO inventory_lots (organisation_id,item_id,location_id,lot_number,status,quantity)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [organisationId, itemId, locationId, lotNumber, status, quantity],
  );
  return rows[0];
}

describe("Disposition d'un lot — correctif de schéma inventory_lots (domaine 3)", () => {
  let app;
  let orgId;
  let itemId;
  let locationId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Lot Disposition Schema E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    app = buildApp();

    const item = await request(app).post("/api/inventory/items").set("x-test-role", "admin").send({ sku: "SKU-LOT-SCHEMA", name: "Article avec lots" });
    itemId = item.body.item.id;
    const location = await request(app).post("/api/inventory/locations").set("x-test-role", "admin").send({ code: "ENT-LOT", name: "Entrepôt lots" });
    locationId = location.body.location.id;
  });

  test("un employé ne peut pas disposer d'un lot", async () => {
    const lot = await insertLot(orgId, { itemId, locationId, lotNumber: "LOT-EMP" });
    const res = await request(app)
      .post(`/api/inventory/lots/${lot.id}/disposition`)
      .set("x-test-role", "employe")
      .send({ status: "quarantined", reason: "x", evidence: [{ note: "x" }] });
    expect(res.status).toBe(403);
  });

  test("raison et évidence obligatoires pour une mise en quarantaine", async () => {
    const lot = await insertLot(orgId, { itemId, locationId, lotNumber: "LOT-VALID" });
    const noReason = await request(app).post(`/api/inventory/lots/${lot.id}/disposition`).set("x-test-role", "admin")
      .send({ status: "quarantined", evidence: [{ note: "x" }] });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe("inventory.lot.reason_required");

    const noEvidence = await request(app).post(`/api/inventory/lots/${lot.id}/disposition`).set("x-test-role", "admin")
      .send({ status: "quarantined", reason: "Contrôle qualité" });
    expect(noEvidence.status).toBe(400);
    expect(noEvidence.body.code).toBe("inventory.lot.evidence_required");
  });

  test("mise en quarantaine réelle : évidence jsonb persistée, événement journalisé", async () => {
    const lot = await insertLot(orgId, { itemId, locationId, lotNumber: "LOT-QUAR" });
    const res = await request(app).post(`/api/inventory/lots/${lot.id}/disposition`).set("x-test-role", "admin")
      .send({ status: "quarantined", reason: "Contrôle qualité en cours", evidence: [{ note: "Rapport d'inspection" }] });
    expect(res.status).toBe(200);
    expect(res.body.lot.status).toBe("quarantined");
    expect(res.body.lot.evidence).toEqual([{ note: "Rapport d'inspection" }]);

    const events = await db.pool.query(
      "SELECT * FROM inventory_status_events WHERE organisation_id=$1 AND aggregate_type='lot' AND aggregate_id=$2",
      [orgId, lot.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].from_status).toBe("available");
    expect(events.rows[0].to_status).toBe("quarantined");
    expect(events.rows[0].evidence).toEqual([{ note: "Rapport d'inspection" }]);
  });

  test("disposition (mise au rebut) réelle : le statut que la contrainte CHECK d'origine rejetait", async () => {
    const lot = await insertLot(orgId, { itemId, locationId, lotNumber: "LOT-DISPOSED", status: "quarantined" });
    const res = await request(app).post(`/api/inventory/lots/${lot.id}/disposition`).set("x-test-role", "admin")
      .send({ status: "disposed", reason: "Produit expiré et non conforme", evidence: [{ note: "Photo du rebut" }] });
    expect(res.status).toBe(200);
    expect(res.body.lot.status).toBe("disposed");
  });

  test("lot introuvable renvoie 404", async () => {
    const res = await request(app).post(`/api/inventory/lots/999999/disposition`).set("x-test-role", "admin")
      .send({ status: "quarantined", reason: "x", evidence: [{ note: "x" }] });
    expect(res.status).toBe(404);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Lot Disposition Schema E2E Org B" });
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
