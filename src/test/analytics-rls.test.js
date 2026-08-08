const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

describe("Analytics events RLS - isolation multi-tenant", () => {
  let connection;
  let roleName;
  let organisationA;
  let organisationB;
  let userA;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    organisationA = await createTestOrganisation({ nom: `Analytics RLS A ${suffix}` });
    organisationB = await createTestOrganisation({ nom: `Analytics RLS B ${suffix}` });
    userA = await createTestUser({
      email: `analytics-rls-a-${suffix}@example.com`,
      organisation_id: organisationA.id,
    });

    roleName = `analytics_rls_${suffix.replaceAll("-", "_")}`;
    connection = await db.pool.connect();
    const quotedRole = quoteIdentifier(roleName);
    await connection.query(
      `CREATE ROLE ${quotedRole} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    await connection.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
    await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_events TO ${quotedRole}`);
    await connection.query(`GRANT USAGE, SELECT ON SEQUENCE analytics_events_id_seq TO ${quotedRole}`);
  });

  beforeEach(async () => {
    await connection.query("BEGIN");
    await connection.query(`SET LOCAL ROLE ${quoteIdentifier(roleName)}`);
    await connection.query(
      "SELECT set_config('app.current_organisation_id', $1, true)",
      [String(organisationA.id)],
    );
  });

  afterEach(async () => {
    await connection.query("ROLLBACK").catch(() => null);
    await connection.query("RESET ROLE").catch(() => null);
  });

  afterAll(async () => {
    if (connection) {
      await connection.query("ROLLBACK").catch(() => null);
      await connection.query("RESET ROLE").catch(() => null);
      if (roleName) {
        await connection.query(`DROP OWNED BY ${quoteIdentifier(roleName)}`).catch(() => null);
        await connection.query(`DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`).catch(() => null);
      }
      connection.release();
    }

    if (organisationA || organisationB) {
      const organisationIds = [organisationA?.id, organisationB?.id].filter(Boolean);
      await db.query("DELETE FROM analytics_events WHERE organisation_id = ANY($1)", [organisationIds]);
      await db.query("DELETE FROM utilisateurs WHERE organisation_id = ANY($1)", [organisationIds]);
      await db.query("DELETE FROM organisations WHERE id = ANY($1)", [organisationIds]);
    }
  });

  test("lit et écrit les événements de son organisation", async () => {
    const inserted = await connection.query(
      `INSERT INTO analytics_events (organisation_id, user_id, event_name, metadata)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [organisationA.id, userA.id, "page_view", { page: "/dashboard" }],
    );

    const selected = await connection.query(
      "SELECT organisation_id FROM analytics_events WHERE id = $1",
      [inserted.rows[0].id],
    );
    expect(selected.rows).toEqual([{ organisation_id: organisationA.id }]);
  });

  test("masque les événements d'une autre organisation", async () => {
    const selected = await connection.query(
      "SELECT id FROM analytics_events WHERE organisation_id = $1",
      [organisationB.id],
    );
    expect(selected.rows).toHaveLength(0);
  });

  test("refuse l'insertion dans une autre organisation", async () => {
    await expect(
      connection.query(
        `INSERT INTO analytics_events (organisation_id, user_id, event_name)
         VALUES ($1, $2, $3)`,
        [organisationB.id, userA.id, "cross_tenant"],
      ),
    ).rejects.toThrow(/row-level security|policy|sécurité au niveau ligne/i);
  });

  test("ne modifie aucune ligne d'une autre organisation", async () => {
    const updated = await connection.query(
      "UPDATE analytics_events SET event_name = $1 WHERE organisation_id = $2",
      ["blocked", organisationB.id],
    );
    expect(updated.rowCount).toBe(0);
  });

  test("ne supprime aucune ligne d'une autre organisation", async () => {
    const deleted = await connection.query(
      "DELETE FROM analytics_events WHERE organisation_id = $1",
      [organisationB.id],
    );
    expect(deleted.rowCount).toBe(0);
  });

  test("conserve l'index organisation + date du schéma canonique", async () => {
    const indexes = await connection.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'analytics_events'
         AND indexname IN ('idx_analytics_events_org_id', 'idx_analytics_events_created_at')`,
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining(["idx_analytics_events_org_id", "idx_analytics_events_created_at"]),
    );
  });
});
