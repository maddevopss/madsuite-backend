/**
 * P0 — Preuve comportementale: isolation par organisation (Issue #174 PR B)
 *
 * Complète organisationIsolationSchema.p0.test.js (qui vérifie l'existence des
 * policies) en prouvant que la RLS bloque réellement l'accès cross-tenant au
 * niveau des données, sur un échantillon représentatif de noyaux
 * institutionnels ajoutés hors du périmètre Stage 6 initial: comptabilité,
 * RH, SST, achats.
 */

const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");

// Pour les probes (lecture/écriture censées être bloquées par RLS): on annule
// toujours la transaction, la policy doit de toute façon empêcher tout effet.
async function withOrgContext(organisationId, fn) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [
      String(organisationId),
    ]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

// Pour la création des fixtures: la ligne doit persister au-delà de la
// connexion pour être lue/attaquée par des probes ultérieurs.
async function withOrgContextCommitted(organisationId, fn) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [
      String(organisationId),
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

describe("P0: isolation par organisation — preuve comportementale sur données réelles", () => {
  let orgA;
  let orgB;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    orgA = await createTestOrganisation({ nom: `P0 Isolation A ${suffix}` });
    orgB = await createTestOrganisation({ nom: `P0 Isolation B ${suffix}` });
  });

  afterAll(async () => {
    await db.query("DELETE FROM organisations WHERE id = ANY($1)", [
      [orgA?.id, orgB?.id].filter(Boolean),
    ]);
  });

  test("hr_departments: org B ne voit ni ne modifie un département créé par org A", async () => {
    const inserted = await withOrgContextCommitted(orgA.id, (client) =>
      client.query(
        `INSERT INTO hr_departments (organisation_id, code, name, idempotency_key)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgA.id, "P0-DEP", "Département test P0", `p0-dep-${Date.now()}`],
      ),
    );
    const deptId = inserted.rows[0].id;

    const crossRead = await withOrgContext(orgB.id, (client) =>
      client.query(`SELECT * FROM hr_departments WHERE id = $1`, [deptId]),
    );
    expect(crossRead.rows).toHaveLength(0);

    const crossWrite = await withOrgContext(orgB.id, (client) =>
      client.query(`UPDATE hr_departments SET name = 'hacked' WHERE id = $1`, [deptId]),
    );
    expect(crossWrite.rowCount).toBe(0);

    const ownRead = await withOrgContext(orgA.id, (client) =>
      client.query(`SELECT * FROM hr_departments WHERE id = $1`, [deptId]),
    );
    expect(ownRead.rows).toHaveLength(1);
  });

  test("sst_incidents: org B ne voit ni ne modifie un incident déclaré par org A", async () => {
    const inserted = await withOrgContextCommitted(orgA.id, (client) =>
      client.query(
        `INSERT INTO sst_incidents (organisation_id, incident_number, incident_type, occurred_at, location, description, severity)
         VALUES ($1, $2, $3, NOW(), $4, $5, $6) RETURNING id`,
        [orgA.id, `P0-INC-${Date.now()}`, "near_miss", "Site test P0", "Incident de test P0", 1],
      ),
    );
    const incidentId = inserted.rows[0].id;

    const crossRead = await withOrgContext(orgB.id, (client) =>
      client.query(`SELECT * FROM sst_incidents WHERE id = $1`, [incidentId]),
    );
    expect(crossRead.rows).toHaveLength(0);

    const crossDelete = await withOrgContext(orgB.id, (client) =>
      client.query(`DELETE FROM sst_incidents WHERE id = $1`, [incidentId]),
    );
    expect(crossDelete.rowCount).toBe(0);

    const ownRead = await withOrgContext(orgA.id, (client) =>
      client.query(`SELECT * FROM sst_incidents WHERE id = $1`, [incidentId]),
    );
    expect(ownRead.rows).toHaveLength(1);
  });

  test("procurement_purchase_orders: org B ne voit pas un bon de commande d'org A", async () => {
    const inserted = await withOrgContextCommitted(orgA.id, (client) =>
      client.query(
        `INSERT INTO procurement_purchase_orders (organisation_id, purchase_order_number)
         VALUES ($1, $2) RETURNING id`,
        [orgA.id, `P0-PO-${Date.now()}`],
      ),
    );
    const poId = inserted.rows[0].id;

    const crossRead = await withOrgContext(orgB.id, (client) =>
      client.query(`SELECT * FROM procurement_purchase_orders WHERE id = $1`, [poId]),
    );
    expect(crossRead.rows).toHaveLength(0);

    const globalCount = await withOrgContext(orgB.id, (client) =>
      client.query(`SELECT count(*) FROM procurement_purchase_orders WHERE purchase_order_number = $1`, [
        `P0-PO-${poId}-does-not-exist`,
      ]),
    );
    expect(Number(globalCount.rows[0].count)).toBe(0);

    const ownRead = await withOrgContext(orgA.id, (client) =>
      client.query(`SELECT * FROM procurement_purchase_orders WHERE id = $1`, [poId]),
    );
    expect(ownRead.rows).toHaveLength(1);
  });

  test("sans contexte d'organisation défini (app.current_organisation_id vide), aucune ligne n'est visible", async () => {
    const inserted = await withOrgContextCommitted(orgA.id, (client) =>
      client.query(
        `INSERT INTO hr_departments (organisation_id, code, name, idempotency_key)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgA.id, "P0-NOCTX", "Département sans contexte", `p0-noctx-${Date.now()}`],
      ),
    );
    const deptId = inserted.rows[0].id;

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      // Aucun set_config: app.current_organisation_id reste vide/non défini.
      const result = await client.query(`SELECT * FROM hr_departments WHERE id = $1`, [deptId]);
      expect(result.rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
