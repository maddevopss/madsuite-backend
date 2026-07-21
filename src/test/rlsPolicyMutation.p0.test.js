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

  test("la preuve devient rouge si les politiques de clients sont retirées", async () => {
    const connection = await db.pool.connect();

    try {
      await connection.query("BEGIN");
      await connection.query(
        "SELECT set_config('app.current_organisation_id', $1, true)",
        [String(organisationA.id)],
      );

      const baseline = await connection.query(
        "SELECT id, organisation_id FROM clients WHERE id = $1",
        [clientB.id],
      );
      expect(baseline.rows).toHaveLength(0);

      const policies = await connection.query(
        `SELECT policyname
         FROM pg_policies
         WHERE schemaname = current_schema()
           AND tablename = 'clients'
         ORDER BY policyname`,
      );
      expect(policies.rows.length).toBeGreaterThan(0);

      for (const { policyname } of policies.rows) {
        await connection.query(
          `DROP POLICY ${quoteIdentifier(policyname)} ON clients`,
        );
      }

      const exposedWithoutPolicies = await connection.query(
        "SELECT id, organisation_id FROM clients WHERE id = $1",
        [clientB.id],
      );
      expect(exposedWithoutPolicies.rows).toEqual([
        {
          id: clientB.id,
          organisation_id: organisationB.id,
        },
      ]);

      await connection.query("ROLLBACK");

      await connection.query("BEGIN");
      await connection.query(
        "SELECT set_config('app.current_organisation_id', $1, true)",
        [String(organisationA.id)],
      );

      const restored = await connection.query(
        "SELECT id, organisation_id FROM clients WHERE id = $1",
        [clientB.id],
      );
      expect(restored.rows).toHaveLength(0);

      const restoredPolicies = await connection.query(
        `SELECT policyname
         FROM pg_policies
         WHERE schemaname = current_schema()
           AND tablename = 'clients'`,
      );
      expect(restoredPolicies.rows).toHaveLength(policies.rows.length);

      await connection.query("ROLLBACK");
    } finally {
      try {
        await connection.query("ROLLBACK");
      } catch {
        // aucune transaction active
      }
      connection.release();
    }
  }, 30000);
});
