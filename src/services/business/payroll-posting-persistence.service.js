const { buildPayrollPosting } = require('./payroll-posting.service');

async function postPayrollJournal(db, organisationId, userId, input) {
  const posting = buildPayrollPosting(input);
  const { rows } = await db.query(
    `INSERT INTO accounting_entries (organisation_id,journal_id,entry_date,description,status,created_by,source_type,source_id,idempotency_key)
     SELECT $1,j.id,$2,$3,'draft',$4,'payroll_run',$5,$6
     FROM accounting_journals j
     WHERE j.organisation_id=$1 AND j.code=COALESCE($7,'PAY')
     ON CONFLICT (organisation_id,idempotency_key) DO UPDATE SET description=accounting_entries.description
     RETURNING *`,
    [organisationId, input.entryDate, input.description || 'Paie', userId || null, input.runId, input.idempotencyKey, input.journalCode],
  );
  return { entry: rows[0], posting };
}

module.exports = { postPayrollJournal };
