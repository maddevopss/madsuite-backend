const db = require('../../db');
const { createTestOrganisation, createTestClient } = require('./helpers/testData');

async function cleanup(orgIds) {
  if (!orgIds.length) return;
  await db.query('DELETE FROM clients WHERE organisation_id = ANY($1)', [orgIds]);
  await db.query('DELETE FROM organisations WHERE id = ANY($1)', [orgIds]);
}

describe('P0 — réutilisation du pool PostgreSQL sans fuite de contexte RLS', () => {
  let orgA;
  let orgB;
  let clientA;
  let clientB;

  beforeAll(async () => {
    orgA = await createTestOrganisation({ nom: `Org RLS A ${Date.now()}` });
    orgB = await createTestOrganisation({ nom: `Org RLS B ${Date.now()}` });

    clientA = await createTestClient({
      nom: `Client RLS A ${Date.now()}`,
      organisation_id: orgA.id,
    });

    clientB = await createTestClient({
      nom: `Client RLS B ${Date.now()}`,
      organisation_id: orgB.id,
    });
  });

  afterAll(async () => {
    await cleanup([orgA.id, orgB.id]);
  });

  test('PROOF: la même connexion A → B ne conserve jamais le contexte précédent', async () => {
    const physicalClient = await db.pool.connect();

    try {
      await physicalClient.query('BEGIN');
      await physicalClient.query(
        "SELECT set_config('app.current_organisation_id', $1, true)",
        [String(orgA.id)],
      );

      const contextA = await physicalClient.query(
        "SELECT current_setting('app.current_organisation_id', true) AS organisation_id",
      );
      expect(contextA.rows[0].organisation_id).toBe(String(orgA.id));

      const rowA = await physicalClient.query(
        'SELECT id, organisation_id FROM clients WHERE id = $1 AND organisation_id = $2',
        [clientA.id, orgA.id],
      );
      expect(rowA.rows).toHaveLength(1);

      await physicalClient.query('COMMIT');

      const contextAfterA = await physicalClient.query(
        "SELECT current_setting('app.current_organisation_id', true) AS organisation_id",
      );
      expect(contextAfterA.rows[0].organisation_id || null).toBeNull();

      await physicalClient.query('BEGIN');
      await physicalClient.query(
        "SELECT set_config('app.current_organisation_id', $1, true)",
        [String(orgB.id)],
      );

      const contextB = await physicalClient.query(
        "SELECT current_setting('app.current_organisation_id', true) AS organisation_id",
      );
      expect(contextB.rows[0].organisation_id).toBe(String(orgB.id));
      expect(contextB.rows[0].organisation_id).not.toBe(String(orgA.id));

      const rowB = await physicalClient.query(
        'SELECT id, organisation_id FROM clients WHERE id = $1 AND organisation_id = $2',
        [clientB.id, orgB.id],
      );
      expect(rowB.rows).toHaveLength(1);

      await physicalClient.query('ROLLBACK');

      const contextAfterB = await physicalClient.query(
        "SELECT current_setting('app.current_organisation_id', true) AS organisation_id",
      );
      expect(contextAfterB.rows[0].organisation_id || null).toBeNull();
    } finally {
      try {
        await physicalClient.query('ROLLBACK');
      } catch {
        // aucune transaction active
      }
      physicalClient.release();
    }
  });

  test('PROOF: cinq alternances A/B sur la même connexion restent étanches', async () => {
    const physicalClient = await db.pool.connect();
    const sequence = [orgA.id, orgB.id, orgA.id, orgB.id, orgA.id];

    try {
      for (const organisationId of sequence) {
        await physicalClient.query('BEGIN');
        await physicalClient.query(
          "SELECT set_config('app.current_organisation_id', $1, true)",
          [String(organisationId)],
        );

        const active = await physicalClient.query(
          "SELECT current_setting('app.current_organisation_id', true) AS organisation_id",
        );
        expect(active.rows[0].organisation_id).toBe(String(organisationId));

        await physicalClient.query('COMMIT');

        const cleared = await physicalClient.query(
          "SELECT current_setting('app.current_organisation_id', true) AS organisation_id",
        );
        expect(cleared.rows[0].organisation_id || null).toBeNull();
      }
    } finally {
      try {
        await physicalClient.query('ROLLBACK');
      } catch {
        // aucune transaction active
      }
      physicalClient.release();
    }
  });
});
