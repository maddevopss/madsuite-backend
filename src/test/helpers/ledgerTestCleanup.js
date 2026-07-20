const db = require("../../../db");

async function deleteLedgerEntriesForTest(organisationId) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      "DELETE FROM ledger_entries WHERE organisation_id = $1",
      [organisationId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { deleteLedgerEntriesForTest };
