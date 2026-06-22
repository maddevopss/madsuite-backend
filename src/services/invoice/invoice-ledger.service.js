const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { getStrictMode } = require("../../core/executionContext");

/**
 * Record a financial transaction in the ledger.
 */
async function recordLedgerEntry({
  organisationId,
  type,
  amount,
  currency = "CAD",
  referenceType,
  referenceId,
  client = db,
  ...extraArgs
}) {
  const mode = getStrictMode();
  if (mode === 'enforce' || mode === 'warn_only') {
    if (extraArgs.id !== undefined || extraArgs.updated_at !== undefined) {
      const msg = "INVARIANT_VIOLATION: append_only_ledger. Ledger entries cannot be updated.";
      console.error(msg);
      try {
        await client.query(`
          INSERT INTO notifications (organisation_id, type, message)
          VALUES ($1, 'system_alert', $2)
        `, [organisationValue(organisationId), msg]);
      } catch(err) {
        console.error("Failed to insert alert", err);
      }
      return null;
    }
  }

  const result = await client.query(
    `
    INSERT INTO ledger_entries
      (organisation_id, type, amount, currency, reference_type, reference_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
    `,
    [
      organisationValue(organisationId),
      type,
      amount,
      currency,
      referenceType,
      referenceId,
    ],
  );

  return result.rows[0];
}

module.exports = {
  recordLedgerEntry,
};
