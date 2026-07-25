const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { recordLedgerEntry } = require("./invoice-ledger.service");
const { recordInvoiceFinalizationAccounting } = require("../business/accounting-sync.service");
const { appendEvent } = require("../business/business-event.service");
const { executeTransaction, registerPolicy } = require("../business/transaction-engine.service");
const { persistTrustAssessment, persistGraphEdges } = require("../business/trust-persistence.service");

const INVOICE_FINALIZATION_POLICY = "invoice.finalize@1";

function evaluateInvoiceFinalizationPolicy({ input }) {
  if (input?.invoiceId === undefined || input?.invoiceId === null || input?.invoiceId === "") {
    return { allowed: false, statusCode: 400, code: "invoice_finalize.invoice_required", reason: "Une facture est requise." };
  }
  return { allowed: true, code: "invoice_finalize.input_valid" };
}

registerPolicy("invoice.finalize", "1", evaluateInvoiceFinalizationPolicy);

async function lockInvoiceNumberSequence(organisationId, client = db) {
  await client.query("SELECT pg_advisory_xact_lock(482019, COALESCE($1::int, 0))", [organisationValue(organisationId)]);
}

async function getNextInvoiceNumber(organisationId, client = db) {
  await lockInvoiceNumberSequence(organisationId, client);
  const seqResult = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '([0-9]+)$') AS INTEGER)), 0) + 1 AS next_seq
     FROM invoices
     WHERE organisation_id = $1`,
    [organisationValue(organisationId)],
  );
  return `FAC-${String(seqResult.rows[0].next_seq).padStart(5, "0")}`;
}

async function executeInvoiceFinalization({ client, transactionId, correlationId, organisationId, actorUserId, input }) {
  const invoiceResult = await client.query(
    `SELECT * FROM invoices
     WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [input.invoiceId, organisationId],
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) return null;
  if (invoice.status !== "draft") {
    throw Object.assign(new Error("Facture déjà finalisée"), { statusCode: 409 });
  }

  const itemsResult = await client.query(
    `SELECT * FROM invoice_items
     WHERE invoice_id = $1 AND organisation_id = $2
     ORDER BY id`,
    [input.invoiceId, organisationId],
  );
  if (!itemsResult.rows.length) {
    throw Object.assign(new Error("Une facture doit contenir au moins une ligne avant sa finalisation."), { statusCode: 409 });
  }

  const snapshot = {
    subtotal: invoice.subtotal,
    tax_total: invoice.tax_total,
    total: invoice.total,
    items: itemsResult.rows,
  };

  const updated = await client.query(
    `UPDATE invoices
     SET status = 'finalized', finalized_at = NOW(), snapshot = $1::jsonb, version = version + 1
     WHERE id = $2 AND organisation_id = $3 AND status = 'draft'
     RETURNING *`,
    [JSON.stringify(snapshot), input.invoiceId, organisationId],
  );
  if (!updated.rowCount) {
    throw Object.assign(new Error("Impossible de finaliser la facture. Elle a peut-être déjà été modifiée."), { statusCode: 409 });
  }

  await recordLedgerEntry({
    organisationId,
    type: "invoice_created",
    amount: invoice.total,
    currency: "CAD",
    referenceType: "invoice",
    referenceId: String(invoice.id),
    client,
  });

  const accounting = await recordInvoiceFinalizationAccounting({
    client,
    organisationId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    subtotal: invoice.subtotal,
    taxTotal: invoice.tax_total,
    total: invoice.total,
    issueDate: invoice.issue_date,
    createdBy: actorUserId,
  });

  const event = await appendEvent(client, {
    organisationId,
    eventType: "invoice.finalized",
    aggregateType: "invoice",
    aggregateId: invoice.id,
    actorUserId,
    correlationId,
    occurredAt: updated.rows[0].finalized_at,
    metadata: { transactionId, policyVersions: [INVOICE_FINALIZATION_POLICY] },
    payload: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      subtotal: Number(invoice.subtotal),
      taxTotal: Number(invoice.tax_total || 0),
      amount: Number(invoice.total),
      accountingEntryId: accounting.entryId || null,
      snapshotVersion: updated.rows[0].version,
    },
  });

  const trust = await persistTrustAssessment(client, {
    organisationId,
    transactionId,
    correlationId,
    checks: [
      { code: "invoice.finalized", passed: updated.rows[0].status === "finalized", evidence: [{ invoiceId: invoice.id, status: updated.rows[0].status }] },
      { code: "invoice.snapshot_frozen", passed: Boolean(updated.rows[0].snapshot), evidence: [{ itemCount: itemsResult.rows.length, version: updated.rows[0].version }] },
      { code: "invoice.event_recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id || null }] },
      {
        code: "invoice.accounting_recorded",
        passed: Boolean(accounting.entryId),
        severity: accounting.entryId ? "info" : "warning",
        explanation: accounting.entryId ? null : "Le plan comptable n’est pas initialisé; aucune écriture approximative n’a été créée.",
        evidence: [{ accountingEntryId: accounting.entryId || null, reason: accounting.reason || null }],
      },
    ],
  });

  const graph = await persistGraphEdges(client, {
    organisationId,
    transactionId,
    correlationId,
    edges: [
      { from: { type: "invoice", id: invoice.id }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } },
      ...(accounting.entryId ? [{ from: { type: "invoice", id: invoice.id }, relation: "accounted_as", to: { type: "accounting_entry", id: accounting.entryId }, provenance: { eventId: event.event_id } }] : []),
      { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: "invoice", id: invoice.id }, provenance: { transactionId } },
    ],
  });

  return { invoice: updated.rows[0], accounting, event, trust, graph };
}

async function verifyInvoiceFinalization({ result }) {
  if (!result) return;
  if (result.invoice?.status !== "finalized") throw Object.assign(new Error("La facture n’est pas finalisée."), { statusCode: 500 });
  if (!result.event?.event_id) throw Object.assign(new Error("L’événement invoice.finalized est absent."), { statusCode: 500 });
  if (!result.trust?.assessmentId) throw Object.assign(new Error("Le constat MADTrust de finalisation est absent."), { statusCode: 500 });
  if (!Array.isArray(result.graph) || result.graph.length < 2) throw Object.assign(new Error("Le graphe métier de finalisation est incomplet."), { statusCode: 500 });
}

async function freezeInvoiceSnapshot(invoiceId, organisationId, createdBy = null) {
  const transaction = await executeTransaction({
    type: "invoice.finalize",
    organisationId: organisationValue(organisationId),
    actorUserId: createdBy,
    policies: [INVOICE_FINALIZATION_POLICY],
    input: { invoiceId },
    execute: executeInvoiceFinalization,
    verify: verifyInvoiceFinalization,
  });
  if (!transaction.result) return null;
  return {
    ...transaction.result.invoice,
    accounting: transaction.result.accounting,
    event: transaction.result.event,
    trust: transaction.result.trust,
    graph: transaction.result.graph,
    ct_mad: {
      transactionId: transaction.transactionId,
      correlationId: transaction.correlationId,
      status: transaction.status,
      policies: transaction.policyResults,
    },
  };
}

async function lockInvoiceForDelete(invoiceId, organisationId) {
  const result = await db.query(
    `SELECT id, status FROM invoices
     WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [invoiceId, organisationValue(organisationId)],
  );
  return result.rows[0] || null;
}

module.exports = {
  INVOICE_FINALIZATION_POLICY,
  evaluateInvoiceFinalizationPolicy,
  executeInvoiceFinalization,
  verifyInvoiceFinalization,
  lockInvoiceNumberSequence,
  getNextInvoiceNumber,
  freezeInvoiceSnapshot,
  lockInvoiceForDelete,
};
