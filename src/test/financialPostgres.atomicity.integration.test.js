const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");

describe("Preuve PostgreSQL financière P0", () => {
  test("stripe_event_id est réellement unique dans payment_events", async () => {
    const eventId = `evt_pg_unique_${Date.now()}_${Math.random()}`;

    try {
      await db.query(
        `
        INSERT INTO payment_events (invoice_id, stripe_event_id, type, payload)
        VALUES (NULL, $1, 'payment_intent.succeeded', $2::jsonb)
        `,
        [eventId, JSON.stringify({ id: eventId })],
      );

      await expect(
        db.query(
          `
          INSERT INTO payment_events (invoice_id, stripe_event_id, type, payload)
          VALUES (NULL, $1, 'payment_intent.succeeded', $2::jsonb)
          `,
          [eventId, JSON.stringify({ id: eventId, replay: true })],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      const persisted = await db.query(
        `SELECT stripe_event_id FROM payment_events WHERE stripe_event_id = $1`,
        [eventId],
      );

      expect(persisted.rows).toHaveLength(1);
    } finally {
      await db.query(`DELETE FROM payment_events WHERE stripe_event_id = $1`, [eventId]);
    }
  });

  test("un rollback physique ne laisse ni événement ni écriture ledger partielle", async () => {
    const organisation = await createTestOrganisation({
      nom: `Org Atomicité Finance ${Date.now()} ${Math.random()}`,
    });
    const eventId = `evt_pg_rollback_${Date.now()}_${Math.random()}`;
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
        INSERT INTO payment_events (invoice_id, stripe_event_id, type, payload)
        VALUES (NULL, $1, 'payment_intent.succeeded', $2::jsonb)
        `,
        [eventId, JSON.stringify({ id: eventId })],
      );

      await client.query(
        `
        INSERT INTO ledger_entries
          (organisation_id, type, amount, currency, reference_type, reference_id)
        VALUES ($1, 'payment_received', 125.00, 'CAD', 'stripe_webhook', $2)
        `,
        [organisation.id, eventId],
      );

      await client.query("ROLLBACK");

      const eventRows = await db.query(
        `SELECT id FROM payment_events WHERE stripe_event_id = $1`,
        [eventId],
      );
      const ledgerRows = await db.query(
        `
        SELECT id
        FROM ledger_entries
        WHERE organisation_id = $1
          AND reference_type = 'stripe_webhook'
          AND reference_id = $2
        `,
        [organisation.id, eventId],
      );

      expect(eventRows.rows).toHaveLength(0);
      expect(ledgerRows.rows).toHaveLength(0);
    } finally {
      try {
        await client.query("ROLLBACK");
      } catch {
        // La transaction peut déjà être terminée.
      }
      client.release();

      await db.query(`DELETE FROM ledger_entries WHERE reference_id = $1`, [eventId]);
      await db.query(`DELETE FROM payment_events WHERE stripe_event_id = $1`, [eventId]);
      await db.query(`DELETE FROM organisations WHERE id = $1`, [organisation.id]);
    }
  });
});
