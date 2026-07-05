const { runDataPurge } = require("../jobs/dataRetention");
const db = require("../../db");
const { createTestUser } = require("./helpers/testData");

async function cleanupOrgs(orgIds) {
  if (!orgIds || orgIds.length === 0) return;

  await db.query("DELETE FROM notifications WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM recurring_invoices WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE organisation_id = ANY($1))", [orgIds]);
  await db.query("DELETE FROM invoices WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM time_entries WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM cognitive_state_events WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM daily_cognitive_metrics WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM clients WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM projets WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM utilisateurs WHERE organisation_id = ANY($1)", [orgIds]);
  await db.query("DELETE FROM organisations WHERE id = ANY($1)", [orgIds]);
}

describe("Data Retention Integration Test", () => {
  let orgA, orgB, userA, userB;

  beforeAll(async () => {
    // Nettoyage et création d'organisations de test
    await db.query("DELETE FROM activity_logs");
    await db.query("DELETE FROM organisations WHERE nom LIKE 'Test Retention%'");

    const resA = await db.query(
      "INSERT INTO organisations (nom, retention_activity_logs_days) VALUES ('Test Retention A', 2) RETURNING id",
    );
    const resB = await db.query(
      "INSERT INTO organisations (nom, retention_activity_logs_days) VALUES ('Test Retention B', 10) RETURNING id",
    );
    orgA = resA.rows[0].id;
    orgB = resB.rows[0].id;
    userA = await createTestUser({ organisation_id: orgA });
    userB = await createTestUser({ organisation_id: orgB });
  });

  afterAll(async () => {
    await db.query("DELETE FROM activity_logs WHERE organisation_id IN ($1, $2)", [orgA, orgB]);
    await db.query("DELETE FROM utilisateurs WHERE organisation_id IN ($1, $2)", [orgA.id, orgB.id]);
await cleanupOrgs([orgA.id, orgB.id]);
  });

  it("should purge logs based on specific organisation retention policies", async () => {
    const now = new Date();

    // Logs pour Org A (Rétention: 2 jours)
    await db.query(
      "INSERT INTO activity_logs (organisation_id, utilisateur_id, captured_at, app_name, is_aggregated) VALUES ($1, $2, $3, 'Stay', true), ($1, $2, $4, 'Purge', true)",
      [orgA, userA.id, now, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)], // 3 jours (trop vieux)
    );

    // Logs pour Org B (Rétention: 10 jours)
    await db.query(
      "INSERT INTO activity_logs (organisation_id, utilisateur_id, captured_at, app_name, is_aggregated) VALUES ($1, $2, $3, 'Stay', true), ($1, $2, $4, 'Stay', true)",
      [orgB, userB.id, now, new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)], // 5 jours (devrait rester)
    );

    // Exécution de la purge
    await runDataPurge(db.pool);

    // Vérification Org A
    const countA = await db.query("SELECT count(*) FROM activity_logs WHERE organisation_id = $1", [orgA]);
    expect(parseInt(countA.rows[0].count)).toBe(1);

    // Vérification Org B
    const countB = await db.query("SELECT count(*) FROM activity_logs WHERE organisation_id = $1", [orgB]);
    expect(parseInt(countB.rows[0].count)).toBe(2);
  });
});
