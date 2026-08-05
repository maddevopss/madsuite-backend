const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");

describe("Ledger append-only PostgreSQL P0", () => {
  test("UPDATE et DELETE sont refusés par défaut, puis une maintenance explicite est auditée", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Ledger Append Only ${Date.now()} ${Math.random()}`,
    });
    const referenceId = `ledger_append_only_${Date.now()}_${Math.random()}`;
    let ledgerEntryId;

    // ledger_entries et ledger_maintenance_audit sont sous FORCE ROW LEVEL
    // SECURITY (organisation_id) depuis la migration
    // 20260805_stage6_pr_b_organisation_isolation.sql: ce test réserve un
    // client dédié et fixe app.current_organisation_id au niveau session
    // (pas transaction) pour garder des requêtes indépendantes, comme avant
    // l'ajout de RLS — chaque assertion .rejects doit rester isolée sans
    // empoisonner les requêtes suivantes.
    const client = await db.connect();

    try {
      await client.query("SELECT set_config('app.current_organisation_id', $1, false)", [
        String(organisation.id),
      ]);

      const inserted = await client.query(
        `
        INSERT INTO ledger_entries
          (organisation_id, type, amount, currency, reference_type, reference_id)
        VALUES ($1, 'payment_received', 125.00, 'CAD', 'append_only_test', $2)
        RETURNING id
        `,
        [organisation.id, referenceId],
      );
      ledgerEntryId = inserted.rows[0].id;

      await expect(
        client.query(`UPDATE ledger_entries SET amount = 999.00 WHERE id = $1`, [ledgerEntryId]),
      ).rejects.toMatchObject({ code: "P0001" });

      await expect(
        client.query(`DELETE FROM ledger_entries WHERE id = $1`, [ledgerEntryId]),
      ).rejects.toMatchObject({ code: "P0001" });

      const unchanged = await client.query(
        `SELECT amount, currency FROM ledger_entries WHERE id = $1`,
        [ledgerEntryId],
      );
      expect(unchanged.rows).toHaveLength(1);
      expect(Number(unchanged.rows[0].amount)).toBe(125);
      expect(unchanged.rows[0].currency).toBe("CAD");

      await client.query("SELECT set_config('app.ledger_maintenance_mode', 'on', false)");
      await client.query("SELECT set_config('app.ledger_maintenance_actor', 'jest-p0', false)");
      await client.query(
        "SELECT set_config('app.ledger_maintenance_reason', 'nettoyage contrôlé de la preuve append-only', false)",
      );
      await client.query(`DELETE FROM ledger_entries WHERE id = $1`, [ledgerEntryId]);

      const removed = await client.query(`SELECT id FROM ledger_entries WHERE id = $1`, [ledgerEntryId]);
      expect(removed.rows).toHaveLength(0);

      const audit = await client.query(
        `
        SELECT operation, actor, reason, database_user, previous_row
        FROM ledger_maintenance_audit
        WHERE ledger_entry_id = $1
        ORDER BY created_at DESC
        `,
        [ledgerEntryId],
      );

      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        operation: "DELETE",
        actor: "jest-p0",
        reason: "nettoyage contrôlé de la preuve append-only",
      });
      expect(audit.rows[0].database_user).toBeTruthy();
      expect(String(audit.rows[0].previous_row.reference_id)).toBe(referenceId);
    } finally {
      if (ledgerEntryId) {
        await client
          .query("SELECT set_config('app.ledger_maintenance_mode', 'on', false)")
          .catch(() => {});
        await client
          .query("SELECT set_config('app.ledger_maintenance_actor', 'jest-cleanup', false)")
          .catch(() => {});
        await client
          .query("SELECT set_config('app.ledger_maintenance_reason', 'nettoyage de secours du test', false)")
          .catch(() => {});
        await client.query(`DELETE FROM ledger_entries WHERE id = $1`, [ledgerEntryId]).catch(() => {});
        await client
          .query(`DELETE FROM ledger_maintenance_audit WHERE ledger_entry_id = $1`, [ledgerEntryId])
          .catch(() => {});
      }

      client.release();
      await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
    }
  });
});
