const DEFAULT_TASKS = [
  { code: 'trial_balance_balanced', label: 'Balance de vérification équilibrée' },
  { code: 'bank_reconciled', label: 'Comptes bancaires rapprochés' },
  { code: 'receivables_reviewed', label: 'Comptes clients révisés' },
  { code: 'payables_reviewed', label: 'Comptes fournisseurs révisés' },
  { code: 'inventory_reviewed', label: 'Inventaire et ajustements révisés' },
  { code: 'depreciation_posted', label: 'Amortissements comptabilisés' },
];

function evaluateReadiness(tasks) {
  const blocking = tasks.filter((task) => task.blocking !== false);
  const incomplete = blocking.filter((task) => !['completed', 'waived'].includes(task.status));
  return {
    ready: incomplete.length === 0,
    total: tasks.length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    waived: tasks.filter((task) => task.status === 'waived').length,
    blockingIncomplete: incomplete.map((task) => task.task_code || task.code),
  };
}

async function seedChecklist(db, organisationId, periodId, userId) {
  await db.query('BEGIN');
  try {
    const { rows } = await db.query(
      `INSERT INTO accounting_close_checklists (organisation_id,period_id,prepared_by,prepared_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (organisation_id,period_id) DO UPDATE SET updated_at=NOW()
       RETURNING *`,
      [organisationId, periodId, userId || null],
    );
    for (const task of DEFAULT_TASKS) {
      await db.query(
        `INSERT INTO accounting_close_tasks (organisation_id,checklist_id,task_code,label)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (organisation_id,checklist_id,task_code) DO NOTHING`,
        [organisationId, rows[0].id, task.code, task.label],
      );
    }
    await db.query('COMMIT');
    return rows[0];
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

module.exports = { DEFAULT_TASKS, evaluateReadiness, seedChecklist };
