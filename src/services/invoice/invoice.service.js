const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { recordBusinessAudit } = require("../auditLog.service");
const analyticsService = require("../analytics.service");
const { getStrictMode } = require("../../core/executionContext");

// Modules Délégués
const { getInvoiceById, listInvoices, listUnbilledEntries, listUnbilledExpenses, getPortalLink } = require("./invoice-query.service");
const { fetchValidEntries, fetchValidExpenses, calculateTotals, calculateEntryHours, calculateEntryRate, roundMoney } = require("./invoice-calculation.service");
const { validateSelectionCount } = require("./invoice-validation.service");
const { getNextInvoiceNumber, freezeInvoiceSnapshot } = require("./invoice-finalization.service");
const { updateInvoice, deleteInvoice, releaseInvoiceTimeEntries, markInvoiceAsSent } = require("./invoice-payment.service");
const { generateInvoicePdfBuffer } = require("../pdf/invoice-pdf.service");
const { recordAiAuditLogs } = require("./invoice-ai-audit.service");

async function createInvoiceFromEntries({
  clientId,
  timeEntryIds,
  issueDate,
  dueDate,
  notes,
  taxRate,
  customDescriptions,
  expenseIds = [],
  organisationId,
  billedBy,
  idempotencyKey,
  req,
}) {
  const requestedEntryIds = [...new Set(timeEntryIds || [])];
  const requestedExpenseIds = [...new Set(expenseIds || [])];
  const txClient = await db.pool.connect();
  
  try {
    await txClient.query("BEGIN");

    if (idempotencyKey) {
      const existingResult = await txClient.query(
        "SELECT * FROM invoices WHERE idempotency_key = $1 AND organisation_id = $2",
        [idempotencyKey, organisationValue(organisationId)]
      );
      if (existingResult.rows.length > 0) {
        const mode = getStrictMode();
        if (mode === 'enforce') {
          await txClient.query("ROLLBACK");
          const err = new Error("INVARIANT_VIOLATION: invoice_idempotency. Duplicate creation attempt blocked.");
          err.statusCode = 409;
          throw err;
        } else if (mode === 'warn_only') {
          console.warn("INVARIANT_VIOLATION: invoice_idempotency. Duplicate creation attempt blocked.");
        }
        await txClient.query("ROLLBACK");
        return existingResult.rows[0];
      }
    }

    const entries = await fetchValidEntries({ requestedEntryIds, clientId, organisationId, lock: true, client: txClient });
    const expenses = await fetchValidExpenses({ requestedExpenseIds, clientId, organisationId, lock: true, client: txClient });

    validateSelectionCount(entries, expenses, requestedEntryIds, requestedExpenseIds);

    const validEntryIds = entries.map((entry) => entry.id);
    const validExpenseIds = expenses.map((exp) => exp.id);
    
    const invoiceNumber = await getNextInvoiceNumber(organisationId, txClient);

    const totals = calculateTotals(entries, expenses, taxRate);
    const billedAt = new Date();

    const invoiceResult = await txClient.query(
      `
      INSERT INTO invoices
        (client_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, notes, organisation_id, billed_at, billed_by, idempotency_key)
      VALUES ($1, $2, 'draft', $3::date, $4::date, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12)
      RETURNING *
      `,
      [
        clientId,
        invoiceNumber,
        issueDate || new Date().toISOString().slice(0, 10),
        dueDate || null,
        totals.subtotal,
        totals.taxTotal,
        totals.total,
        notes || null,
        organisationValue(organisationId),
        billedAt.toISOString(),
        billedBy,
        idempotencyKey || null,
      ],
    );

    const invoice = invoiceResult.rows[0];

    const itemValues = [];
    const itemParams = [];
    let paramIdx = 1;

    for (const entry of entries) {
      const hours = calculateEntryHours(entry);
      const rate = calculateEntryRate(entry);
      const amount = roundMoney(hours * rate);

      itemValues.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8})`);
      itemParams.push(
        organisationValue(organisationId),
        invoice.id,
        entry.id,
        (customDescriptions && customDescriptions[entry.id]) || entry.description || entry.projet_nom || "Prestation",
        Math.round(hours * 100) / 100,
        roundMoney(rate),
        amount,
        new Date().toISOString(),
        entry.description || null,
      );
      paramIdx += 9;
    }

    for (const exp of expenses) {
      itemValues.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8})`);
      itemParams.push(
        organisationValue(organisationId),
        invoice.id,
        null,
        exp.description || exp.projet_nom || "Dépense",
        1,
        roundMoney(exp.montant),
        roundMoney(exp.montant),
        new Date().toISOString(),
        exp.description || null,
      );
      paramIdx += 9;
    }

    await txClient.query(
      `INSERT INTO invoice_items (organisation_id, invoice_id, time_entry_id, description, quantity, unit_rate, amount, created_at, original_description)
       VALUES ${itemValues.join(", ")}`,
      itemParams,
    );

    const updatedEntries = await txClient.query(
      `UPDATE time_entries SET is_billed = TRUE, invoice_id = $1 WHERE id = ANY($2) AND organisation_id = $3 AND end_time IS NOT NULL AND is_billed = FALSE AND invoice_id IS NULL`,
      [invoice.id, validEntryIds, organisationValue(organisationId)],
    );

    if (updatedEntries.rowCount !== validEntryIds.length) {
      const err = new Error("Certaines entrées ont été réservées dans une autre facture en parallèle.");
      err.statusCode = 409;
      throw err;
    }

    if (validExpenseIds.length > 0) {
      const updatedExpenses = await txClient.query(
        `UPDATE expenses SET is_billed = TRUE, invoice_id = $1 WHERE id = ANY($2) AND organisation_id = $3 AND is_billed = FALSE AND invoice_id IS NULL`,
        [invoice.id, validExpenseIds, organisationValue(organisationId)],
      );

      if (updatedExpenses.rowCount !== validExpenseIds.length) {
        const err = new Error("Certaines dépenses ont été réservées dans une autre facture.");
        err.statusCode = 409;
        throw err;
      }
    }

    await recordAiAuditLogs({ txClient, organisationId, req, timeEntryIds: validEntryIds, expenseIds: validExpenseIds, invoiceId: invoice.id });

    const mode = getStrictMode();
    if (mode === 'enforce' || mode === 'warn_only') {
      const unbilledEntriesCheck = await txClient.query(
        `SELECT id FROM time_entries WHERE invoice_id = $1 AND is_billed = FALSE`,
        [invoice.id]
      );
      if (unbilledEntriesCheck.rows.length > 0) {
        const err = new Error("INVARIANT_VIOLATION: invoice_immutability_lock. Some linked time entries were not locked.");
        if (mode === 'enforce') {
          err.statusCode = 409;
          throw err;
        } else {
          console.warn(err.message);
        }
      }
    }

    await txClient.query("COMMIT");

    await recordBusinessAudit({
      organisationId,
      actorUserId: req?.user?.id ?? null,
      action: "invoice.created",
      entityType: "invoice",
      entityId: invoice.id,
      details: { clientId, timeEntryCount: requestedEntryIds.length },
      req,
    });

    await analyticsService.trackEvent("invoice_created", {
      organisationId,
      userId: billedBy,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        total: invoice.total,
        isFromEstimate: false
      }
    });

    return invoice;
  } catch (err) {
    try {
      await txClient.query("ROLLBACK");
    } catch (_) {}
    throw err;
  } finally {
    txClient.release();
  }
}

async function createInvoiceFromEstimate({ estimate, organisationId, billedBy, req }) {
  const txClient = await db.pool.connect();
  try {
    await txClient.query("BEGIN");

    const invoiceNumber = await getNextInvoiceNumber(organisationId, txClient);
    const billedAt = new Date();

    const invoiceResult = await txClient.query(
      `
      INSERT INTO invoices
        (client_id, estimate_id, invoice_number, status, issue_date, due_date, subtotal, tax_total, total, notes, organisation_id, billed_at, billed_by)
      VALUES ($1, $2, $3, 'draft', $4::date, NULL, $5, $6, $7, $8, $9, $10::timestamptz, $11)
      RETURNING *
      `,
      [
        estimate.client_id,
        estimate.id,
        invoiceNumber,
        new Date().toISOString().slice(0, 10),
        estimate.subtotal,
        estimate.tax_total,
        estimate.total,
        estimate.notes || null,
        organisationValue(organisationId),
        billedAt.toISOString(),
        billedBy,
      ]
    );

    const invoice = invoiceResult.rows[0];

    if (estimate.items && estimate.items.length > 0) {
      const itemValues = [];
      const itemParams = [];
      let paramIdx = 1;

      for (const item of estimate.items) {
        itemValues.push(`($${paramIdx}, $${paramIdx + 1}, NULL, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6})`);
        itemParams.push(
          organisationValue(organisationId),
          invoice.id,
          item.description,
          item.quantity,
          item.unit_rate,
          item.amount,
          new Date().toISOString()
        );
        paramIdx += 7;
      }

      await txClient.query(
        `INSERT INTO invoice_items (organisation_id, invoice_id, time_entry_id, description, quantity, unit_rate, amount, created_at)
         VALUES ${itemValues.join(", ")}`,
        itemParams
      );
    }

    await recordBusinessAudit({
      organisationId,
      actorUserId: billedBy,
      action: "invoice.created_from_estimate",
      entityType: "invoice",
      entityId: invoice.id,
      details: { estimateId: estimate.id, invoiceNumber },
      req,
    });

    await txClient.query("COMMIT");

    await analyticsService.trackEvent("invoice_created", {
      organisationId,
      userId: billedBy,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        total: invoice.total,
        isFromEstimate: true,
        estimateId: estimate.id
      }
    });

    return invoice;
  } catch (err) {
    try {
      await txClient.query("ROLLBACK");
    } catch (_) {}
    throw err;
  } finally {
    txClient.release();
  }
}

async function generateInvoicePdf({ invoiceId, organisationId }) {
  const invoice = await getInvoiceById({ invoiceId, organisationId });
  if (!invoice) return null;
  const buffer = await generateInvoicePdfBuffer(invoice, organisationId);
  return { invoice, buffer };
}

async function makeInvoiceRecurring({ invoiceId, organisationId, frequency, nextIssueDate, req }) {
  const invoice = await getInvoiceById({ invoiceId, organisationId });
  if (!invoice) throw new Error("Facture introuvable");

  const query = `
    INSERT INTO recurring_invoices (organisation_id, client_id, template_invoice_id, frequency, next_issue_date)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const res = await db.query(query, [organisationId, invoice.client_id, invoice.id, frequency, nextIssueDate]);
  
  await recordBusinessAudit({
    organisationId,
    actorUserId: req?.user?.id ?? null,
    action: "invoice.made_recurring",
    entityType: "recurring_invoice",
    entityId: res.rows[0].id,
    details: { invoiceId, frequency, nextIssueDate },
    req,
  });

  await analyticsService.trackEvent("recurring_enabled", {
    organisationId,
    userId: req?.user?.id ?? null,
    metadata: {
      invoiceId,
      recurringInvoiceId: res.rows[0].id,
      frequency
    }
  });

  return res.rows[0];
}

async function getRecurringInvoices(organisationId) {
  const query = `
    SELECT r.*, c.nom as client_nom, i.total 
    FROM recurring_invoices r
    JOIN clients c ON r.client_id = c.id
    JOIN invoices i ON r.template_invoice_id = i.id
    WHERE r.organisation_id = $1
    ORDER BY r.created_at DESC
  `;
  const res = await db.query(query, [organisationId]);
  return res.rows;
}

module.exports = {
  // Orchestrated methods
  createInvoiceFromEntries,
  createInvoiceFromEstimate,
  generateInvoicePdf,
  makeInvoiceRecurring,
  getRecurringInvoices,
  
  // Delegated queries
  getInvoiceById,
  listInvoices,
  listUnbilledEntries,
  listUnbilledExpenses,
  getPortalLink,
  
  // Delegated actions
  updateInvoice,
  deleteInvoice,
  releaseInvoiceTimeEntries,
  freezeInvoiceSnapshot,
  markInvoiceAsSent,
};
