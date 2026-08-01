// Preuve d'exécution réelle de deux correctifs de POST
// /inventory/cycle-counts/:id/approve (domaine 3), tous deux masqués jusqu'ici
// par le même piège méthodologique : le harnais de test mocke req.db avec le
// pool brut, dont les méthodes fonctionnent différemment d'un vrai client
// PostgreSQL en transaction.
//
// 1) La route appelait `await req.db.connect()` sur req.db, qui est déjà un
//    client PostgreSQL connecté et en transaction (organization.middleware
//    ouvre la connexion et le BEGIN avant d'appeler la route).
//    pg.Client.connect() lève "Client has already been connected. You cannot
//    reuse a client." dans ce cas — la route était donc cassée à 100% en
//    production (toujours 500).
// 2) Une fois ce premier bug corrigé, un second est apparu : `evidence`
//    (colonne jsonb) recevait un tableau JS brut sans JSON.stringify — node-
//    postgres sérialise un tableau JS comme un littéral ARRAY Postgres
//    (`{...}`), pas comme du JSON, ce qui lève "invalid input syntax for
//    type json".
//
// POST /lots/:id/disposition a le même défaut de sérialisation jsonb sur sa
// colonne evidence, mais s'est révélé bloqué plus en amont par un bug déjà
// documenté et hors périmètre (inventory_lots n'a pas de colonne quantity —
// validateLotDisposition rejette donc systématiquement en
// inventory.lot.quantity_invalid avant même d'atteindre l'écriture). Ce
// correctif n'est donc pas inclus ici : il ne peut pas être prouvé tant que
// ce bug plus profond n'est pas réglé (voir le prochain micro-bloc
// recommandé).
//
// Ce test utilise un client réel obtenu via pool.connect() pour req.db
// (comme en production) plutôt que le pool lui-même, afin de reproduire
// fidèlement le contexte qui a révélé ces bugs. Il n'existe aucune route
// pour créer un comptage cyclique ; les données de test sont donc injectées
// directement en base, comme pour d'autres rapports de ce domaine.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");

const mockState = { organisationId: null, client: null };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = mockState.organisationId;
    req.db = mockState.client;
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

async function seedCycleCount(client, organisationId, { locationId, itemId, expectedQuantity, countedQuantity }) {
  const count = await client.query(
    `INSERT INTO inventory_cycle_counts (organisation_id,count_number,location_id,status,idempotency_key)
     VALUES ($1,$2,$3,'submitted',$4) RETURNING *`,
    [organisationId, `CC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, locationId, `cc-idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
  );
  await client.query(
    `INSERT INTO inventory_cycle_count_items (organisation_id,cycle_count_id,item_id,expected_quantity,counted_quantity,unit_cost)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [organisationId, count.rows[0].id, itemId, expectedQuantity, countedQuantity, 10],
  );
  return count.rows[0];
}

describe("Approbation de comptage cyclique — correctif req.db.connect() (domaine 3)", () => {
  let app;
  let orgId;
  let itemId;
  let locationId;
  let client;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Cycle Count Approve E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    app = buildApp();

    // Client dédié pour créer l'article/emplacement en dehors du mock de
    // transaction par requête (voir plus bas pour req.db en production).
    const setupClient = await db.pool.connect();
    await setupClient.query("BEGIN");
    await setupClient.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(orgId)]);
    const item = await setupClient.query(
      `INSERT INTO inventory_items (organisation_id,sku,name) VALUES ($1,'SKU-CC','Article compté') RETURNING id`,
      [orgId],
    );
    itemId = item.rows[0].id;
    const location = await setupClient.query(
      `INSERT INTO inventory_locations (organisation_id,code,name) VALUES ($1,'ENT-CC','Entrepôt comptage') RETURNING id`,
      [orgId],
    );
    locationId = location.rows[0].id;
    await setupClient.query("COMMIT");
    setupClient.release();
  });

  beforeEach(async () => {
    // Reproduit fidèlement organization.middleware : un client PostgreSQL
    // déjà connecté et déjà en transaction (BEGIN émis) — pas le pool.
    client = await db.pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(orgId)]);
    mockState.client = client;
  });

  afterEach(async () => {
    await client.query("COMMIT");
    client.release();
  });

  test("un employé ne peut pas approuver un comptage cyclique", async () => {
    const count = await seedCycleCount(client, orgId, { locationId, itemId, expectedQuantity: 10, countedQuantity: 10 });
    const res = await request(app)
      .post(`/api/inventory/cycle-counts/${count.id}/approve`)
      .set("x-test-role", "employe")
      .send({ evidence: [{ note: "Photo du comptage" }] });
    expect(res.status).toBe(403);
  });

  test("approbation réelle (sans écart) : la route répond enfin au lieu de planter sur req.db.connect()", async () => {
    const count = await seedCycleCount(client, orgId, { locationId, itemId, expectedQuantity: 10, countedQuantity: 10 });
    const res = await request(app)
      .post(`/api/inventory/cycle-counts/${count.id}/approve`)
      .set("x-test-role", "admin")
      .send({ evidence: [{ note: "Photo du comptage" }] });
    expect(res.status).toBe(200);
    expect(res.body.cycleCount.status).toBe("approved");
    expect(Number(res.body.cycleCount.variance_value)).toBe(0);
  });

  test("approbation avec écart : exige une raison de décision, calcule la valeur de l'écart, journalise l'événement", async () => {
    const count = await seedCycleCount(client, orgId, { locationId, itemId, expectedQuantity: 10, countedQuantity: 7 });

    const missingReason = await request(app)
      .post(`/api/inventory/cycle-counts/${count.id}/approve`)
      .set("x-test-role", "admin")
      .send({ evidence: [{ note: "Écart constaté" }] });
    expect(missingReason.status).toBe(400);
    expect(missingReason.body.code).toBe("inventory.count.variance_reason_required");

    const approved = await request(app)
      .post(`/api/inventory/cycle-counts/${count.id}/approve`)
      .set("x-test-role", "admin")
      .send({ evidence: [{ note: "Écart constaté" }], decisionReason: "Bris confirmé à l'entrepôt" });
    expect(approved.status).toBe(200);
    expect(approved.body.cycleCount.status).toBe("approved");
    expect(Number(approved.body.cycleCount.variance_value)).toBe(-30); // (7-10) * 10

    const events = await client.query(
      "SELECT * FROM inventory_status_events WHERE organisation_id=$1 AND aggregate_type='cycle_count' AND aggregate_id=$2",
      [orgId, count.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].to_status).toBe("approved");
  });

  test("un comptage introuvable renvoie 404, pas 500", async () => {
    const res = await request(app)
      .post(`/api/inventory/cycle-counts/999999/approve`)
      .set("x-test-role", "admin")
      .send({ evidence: [{ note: "n/a" }] });
    expect(res.status).toBe(404);
  });
});
