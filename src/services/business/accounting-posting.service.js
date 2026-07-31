const db = require("../../../db");
const { recordExpenseAccounting } = require("./accounting-sync.service");
const { appendEvent } = require("./business-event.service");
const supplierBillLifecycleService = require("./supplier-bill-lifecycle.service");

async function postExpense({ expenseId, organisationId, createdBy }) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [
      String(organisationId),
    ]);
    const result = await client.query(
      `SELECT * FROM expenses
       WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [expenseId, organisationId],
    );
    const expense = result.rows[0];
    if (!expense) {
      await client.query("ROLLBACK");
      return null;
    }
    if (expense.accounting_status === "posted" && expense.accounting_entry_id) {
      await client.query("COMMIT");
      return { expense, duplicate: true, accountingEntryId: expense.accounting_entry_id };
    }

    const accounting = await recordExpenseAccounting({ client, organisationId, expense, createdBy });
    if (accounting.skipped) {
      await client.query("COMMIT");
      return { expense, duplicate: false, accounting };
    }

    const updated = await client.query(
      `UPDATE expenses
       SET accounting_status = 'posted', accounting_entry_id = $1
       WHERE id = $2 AND organisation_id = $3
       RETURNING *`,
      [accounting.entryId, expenseId, organisationId],
    );
    const event = await appendEvent(client, {
      organisationId,
      eventType: "expense.posted",
      aggregateType: "expense",
      aggregateId: expenseId,
      actorUserId: createdBy,
      occurredAt: expense.expense_date,
      payload: {
        expenseId,
        amount: Number(expense.total_amount),
        subtotal: Number(expense.amount),
        taxTotal: Number(expense.tax_amount || 0),
        accountingEntryId: accounting.entryId,
      },
    });
    await client.query("COMMIT");
    return { expense: updated.rows[0], duplicate: accounting.duplicate, accounting, event };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function approveSupplierBill(args) {
  return supplierBillLifecycleService.approveSupplierBill(args);
}

module.exports = { postExpense, approveSupplierBill };
