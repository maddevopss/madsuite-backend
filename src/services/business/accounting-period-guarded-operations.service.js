const accountingService = require("./accounting.service");
const { assertOpenAccountingPeriod } = require("./accounting-period-lock.service");

async function createEntry(db, organisationId, userId, payload) {
  await assertOpenAccountingPeriod(db, {
    organisationId,
    entryDate: payload?.entryDate,
    operation: "accounting.entry.create",
  });
  return accountingService.createEntry(db, organisationId, userId, payload);
}

async function postEntry(db, organisationId, entryId) {
  const result = await db.query(
    `SELECT id, entry_date, status
       FROM accounting_entries
      WHERE organisation_id=$1 AND id=$2`,
    [organisationId, entryId],
  );
  const entry = result.rows[0] || null;
  if (!entry) return null;

  await assertOpenAccountingPeriod(db, {
    organisationId,
    entryDate: entry.entry_date,
    operation: "accounting.entry.post",
  });
  return accountingService.postEntry(db, organisationId, entryId);
}

async function reverseEntry(db, organisationId, userId, entryId, reversalDate, reason) {
  await assertOpenAccountingPeriod(db, {
    organisationId,
    entryDate: reversalDate,
    operation: "accounting.entry.reverse",
  });
  return accountingService.reverseEntry(db, organisationId, userId, entryId, reversalDate, reason);
}

module.exports = {
  createEntry,
  postEntry,
  reverseEntry,
};
