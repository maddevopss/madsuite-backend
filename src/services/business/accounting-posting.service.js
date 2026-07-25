const db = require("../../../db");
const { recordExpenseAccounting, recordSupplierBillAccounting } = require("./accounting-sync.service");
const { appendEvent } = require("./business-event.service");

async function postExpense({ expenseId, organisationId, createdBy }) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
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

async function approveSupplierBill({ billId, organisationId, createdBy }) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM supplier_bills
       WHERE id = $1 AND organisation_id = $2
       FOR UPDATE`,
      [billId, organisationId],
    );
    const bill = result.rows[0];
    if (!bill) {
      await client.query("ROLLBACK");
      return null;
    }
    if (["approved", "partially_paid", "paid"].includes(bill.status) && bill.accounting_entry_id) {
      await client.query("COMMIT");
      return { bill, duplicate: true, accountingEntryId: bill.accounting_entry_id };
    }
    if (bill.status !== "draft") {
      throw Object.assign(new Error("Seule une facture fournisseur en brouillon peut être approuvée."), { statusCode: 409 });
    }

    const accounting = await recordSupplierBillAccounting({ client, organisationId, bill, createdBy });
    if (accounting.skipped) {
      await client.query("COMMIT");
      return { bill, duplicate: false, accounting };
    }

    const updated = await client.query(
      `UPDATE supplier_bills
       SET status = 'approved', accounting_entry_id = $1
       WHERE id = $2 AND organisation_id = $3 AND status = 'draft'
       RETURNING *`,
      [accounting.entryId, billId, organisationId],
    );
    if (!updated.rowCount) throw Object.assign(new Error("La facture fournisseur a été modifiée en parallèle."), { statusCode: 409 });

    const event = await appendEvent(client, {
      organisationId,
      eventType: "supplier.bill.approved",
      aggregateType: "supplier_bill",
      aggregateId: billId,
      actorUserId: createdBy,
      occurredAt: bill.bill_date,
      payload: {
        billId,
        supplierId: bill.supplier_id,
        billNumber: bill.bill_number,
        amount: Number(bill.total),
        subtotal: Number(bill.subtotal),
        taxTotal: Number(bill.tax_total || 0),
        accountingEntryId: accounting.entryId,
      },
    });

    await client.query("COMMIT");
    return { bill: updated.rows[0], duplicate: accounting.duplicate, accounting, event };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { postExpense, approveSupplierBill };
