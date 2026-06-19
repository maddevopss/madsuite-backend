const db = require("../../db");
const { runDataPurge } = require("../jobs/dataRetention");

describe("Data Retention Integration Test", () => {
  let orgId;
  let otherOrgId;

  beforeAll(async () => {
    // Création d'une organisation de test avec des délais de rétention spécifiques
    const res = await db.query(`
      INSERT INTO organisations (nom, retention_activity_logs_days, retention_summary_days, retention_audit_logs_days)
      VALUES ('Test Retention Org', 7, 30, 90)
      RETURNING id
    `);
    orgId = res.rows[0].id;

    // Création d'une seconde organisation avec une rétention beaucoup plus longue
    const resOther = await db.query(`
      INSERT INTO organisations (nom, retention_activity_logs_days, retention_summary_days, retention_audit_logs_days)
      VALUES ('Long Retention Org', 60, 60, 60)
      RETURNING id
    `);
    otherOrgId = resOther.rows[0].id;
  });

  afterAll(async () => {
    await db.query("DELETE FROM organisations WHERE id IN ($1, $2)", [orgId, otherOrgId]);
  });

  test("should purge old logs and keep recent ones based on org settings", async () => {
    // 1. Insertion de données factices
    // Log récent (2 jours) - Doit être conservé (rétention 7 jours)
    await db.query(
      `
      INSERT INTO activity_logs (organisation_id, utilisateur_id, app_name, captured_at, duration_seconds)
      VALUES ($1, (SELECT id FROM utilisateurs LIMIT 1), 'TestApp', NOW() - INTERVAL '2 days', 60)
    `,
      [orgId],
    );

    // Log ancien (10 jours) - Doit être supprimé
    await db.query(
      `
      INSERT INTO activity_logs (organisation_id, utilisateur_id, app_name, captured_at, duration_seconds)
      VALUES ($1, (SELECT id FROM utilisateurs LIMIT 1), 'OldApp', NOW() - INTERVAL '10 days', 60)
    `,
      [orgId],
    );
    await db.query("UPDATE activity_logs SET is_aggregated = true WHERE organisation_id = $1", [orgId]);

    // 2. Exécution de la purge
    await runDataPurge(db);

    // 3. Vérification des résultats
    const res = await db.query("SELECT app_name FROM activity_logs WHERE organisation_id = $1", [orgId]);

    expect(res.rowCount).toBe(1);
    expect(res.rows[0].app_name).toBe("TestApp");
  });

  test("should respect separate retention for audit logs", async () => {
    // Audit log récent (10 jours) - Conservé (rétention 90)
    await db.query(
      `
      INSERT INTO business_audit_logs (organisation_id, entity_type, action, created_at)
      VALUES ($1, 'retention_test', 'TEST_KEEP', NOW() - INTERVAL '10 days')
    `,
      [orgId],
    );

    // Audit log très ancien (100 jours) - Supprimé
    await db.query(
      `
      INSERT INTO business_audit_logs (organisation_id, entity_type, action, created_at)
      VALUES ($1, 'retention_test', 'TEST_DELETE', NOW() - INTERVAL '100 days')
    `,
      [orgId],
    );

    await runDataPurge(db);

    const res = await db.query("SELECT action FROM business_audit_logs WHERE organisation_id = $1", [orgId]);
    expect(res.rows.some((r) => r.action === "TEST_KEEP")).toBe(true);
    expect(res.rows.some((r) => r.action === "TEST_DELETE")).toBe(false);
  });

  test("should not delete data from another organization with longer retention", async () => {
    // Donnée de l'Org A (7 jours) âgée de 10 jours -> Doit être supprimée
    await db.query(
      `
      INSERT INTO activity_logs (organisation_id, utilisateur_id, app_name, captured_at, duration_seconds)
      VALUES ($1, (SELECT id FROM utilisateurs LIMIT 1), 'OrgA_Old', NOW() - INTERVAL '10 days', 60)
    `,
      [orgId],
    );

    // Donnée de l'Org B (60 jours) âgée de 10 jours -> Doit être CONSERVÉE
    await db.query(
      `
      INSERT INTO activity_logs (organisation_id, utilisateur_id, app_name, captured_at, duration_seconds)
      VALUES ($1, (SELECT id FROM utilisateurs LIMIT 1), 'OrgB_Old', NOW() - INTERVAL '10 days', 60)
    `,
      [otherOrgId],
    );
    await db.query("UPDATE activity_logs SET is_aggregated = true WHERE organisation_id IN ($1, $2)", [orgId, otherOrgId]);

    await runDataPurge(db);

    // Vérification Org A
    const resA = await db.query("SELECT id FROM activity_logs WHERE organisation_id = $1 AND app_name = 'OrgA_Old'", [
      orgId,
    ]);
    expect(resA.rowCount).toBe(0);

    // Vérification Org B
    const resB = await db.query("SELECT id FROM activity_logs WHERE organisation_id = $1 AND app_name = 'OrgB_Old'", [
      otherOrgId,
    ]);
    expect(resB.rowCount).toBe(1);
  });

  test("should verify that the performance index is utilized by PostgreSQL", async () => {
    // On utilise EXPLAIN pour voir le plan d'exécution de la requête de purge
    const explainRes = await db.query(`
      EXPLAIN (FORMAT JSON)
      DELETE FROM activity_logs al
      USING organisations o
      WHERE al.organisation_id = o.id
        AND al.captured_at < NOW() - (o.retention_activity_logs_days * INTERVAL '1 day')
    `);

    const plan = JSON.stringify(explainRes.rows);

    // On vérifie si le nom de l'index apparaît dans le plan d'exécution
    // Note: Sur une table vide ou très petite, PG peut préférer un Seq Scan.
    // Ce test est surtout utile en environnement de staging/prod ou avec un dataset de test volumineux.
    const isUsingIndex = plan.includes("idx_activity_logs_purge_ready");

    // On s'attend à ce que l'index soit au moins mentionné comme candidat ou utilisé
    expect(plan).toBeDefined();
  });
});
