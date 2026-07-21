const db = require("../../db");
const {
  createTestOrganisation,
  createTestClient,
} = require("./helpers/testData");

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function cleanup(organisationIds) {
  if (!organisationIds.length) return;
  await db.query("DELETE FROM clients WHERE organisation_id = ANY($1)", [organisationIds]);
  await db.query("DELETE FROM organisations WHERE id = ANY($1)", [organisationIds]);
}

async function createRestrictedRole(connection, roleName) {
  const quotedRole = quoteIdentifier(roleName);
  await connection.query(
    `CREATE ROLE ${quotedRole} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
  );
  await connection.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
  await connection.query(`GRANT SELECT ON clients TO ${quotedRole}`);
}

async function queryAsRestrictedRole(connection, roleName, organisationId, clientId) {
  await connection.query(`SET LOCAL ROLE ${quoteIdentifier(roleName)}`);
  await connection.query(
    "SELECT set_config('app.current_organisation_id', $1, true)",
    [String(organisationId)],
  );
  const result = await connection.query(
    "SELECT id, organisation_id FROM clients WHERE id = $1",
    [clientId],
  );
  await connection.query("RESET ROLE");
  return result;
}

async function readRlsState(connection) {
  const result = await connection.query(
    `SELECT c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema()
       AND c.relname = 'clients'`,
  );
  return result.rows[0];
}

describe("P0 — mutation contrôlée d'une politique RLS", () => {
  let organisationA;
  let organisationB;
  let clientB;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    organisationA = await createTestOrganisation({ nom: `Org mutation RLS A ${suffix}` });
    organisationB = await createTestOrganisation({ nom: `Org mutation RLS B ${suffix}` });
    clientB = await createTestClient({
      nom: `Client mutation RLS B ${suffix}`,
      organisation_id: organisationB.id,
    });
  });

  afterAll(async () => {
    await cleanup([organisationA.id, organisationB.id]);
  });

  test("la preuve devient rouge si la RLS de clients est désactivée", async () => {
    const connection = await db.pool.connect();
    const roleName = `madproof_rls_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    try {
      await connection.query("BEGIN");
      await createRestrictedRole(connection, roleName);

      const initialRlsState = await readRlsState(connection);
      expect(initialRlsState).toMatchObject({ relrowsecurity: true });

      const policies = await connection.query(
        `SELECT policyname
         FROM pg_policies
         WHERE schemaname = current_schema()
           AND tablename = 'clients'
         ORDER BY policyname`,
      );
      expect(policies.rows.length).toBeGreaterThan(0);

      const baseline = await queryAsRestrictedRole(
        connection,
        roleName,
        organisationA.id,
        clientB.id,
      );
      expect(baseline.rows).toHaveLength(0);

      await connection.query("ALTER TABLE clients DISABLE ROW LEVEL SECURITY");

      const disabledRlsState = await readRlsState(connection);
      expect(disabledRlsState).toMatchObject({ relrowsecurity: false });

      const exposedWithoutRls = await queryAsRestrictedRole(
        connection,
        roleName,
        organisationA.id,
        clientB.id,
      );
      expect(exposedWithoutRls.rows).toEqual([
        {
          id: clientB.id,
          organisation_id: organisationB.id,
        },
      ]);

      await connection.query("ROLLBACK");

      await connection.query("BEGIN");
      await createRestrictedRole(connection, roleName);

      const restoredRlsState = await readRlsState(connection);
      expect(restoredRlsState).toEqual(initialRlsState);

      const restoredPolicies = await connection.query(
        `SELECT policyname
         FROM pg_policies
         WHERE schemaname = current_schema()
           AND tablename = 'clients'
         ORDER BY policyname`,
      );
      expect(restoredPolicies.rows).toEqual(policies.rows);

      const restored = await queryAsRestrictedRole(
        connection,
        roleName,
        organisationA.id,
        clientB.id,
      );
      expect(restored.rows).toHaveLength(0);

      await connection.query("ROLLBACK");
    } finally {
      try {
        await connection.query("RESET ROLE");
        await connection.query("ROLLBACK");
      } catch {
        // aucune transaction active
      }
      connection.release();
    }
  }, 30000);
});
