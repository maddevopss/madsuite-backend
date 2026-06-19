// backend/src/services/hub.service.js

/**
 * Service layer for the Smart Work‑Flow Hub.
 * Provides CRUD operations for projects, tasks, quotes, invoices and payments.
 * All functions expect a `organisationId` (extracted from JWT) for multi‑tenant isolation.
 */

const db = require('../utils/db'); // assume a pg client wrapper exists

/** Helper to enforce organisation scoping */
function scopedQuery(query, orgId, params = []) {
  // prepend organisation filter to every query
  const scoped = `${query} WHERE organisation_id = $1`;
  return db.query(scoped, [orgId, ...params]);
}

module.exports = {
  // ---------- Projects ----------
  async getProjects(orgId) {
    const { rows } = await scopedQuery('SELECT * FROM projects', orgId);
    return rows;
  },

  async createProject(orgId, { name, description }) {
    const { rows } = await db.query(
      `INSERT INTO projects (organisation_id, name, description, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [orgId, name, description]
    );
    return rows[0];
  },

  // ---------- Times & Tasks ----------
  async startTask(orgId, { projectId, description }) {
    const { rows } = await db.query(
      `INSERT INTO tasks (organisation_id, project_id, description, start_time, status)
       VALUES ($1, $2, $3, NOW(), 'running') RETURNING *`,
      [orgId, projectId, description]
    );
    return rows[0];
  },

  async stopTask(orgId, taskId) {
    const { rows } = await db.query(
      `UPDATE tasks SET end_time = NOW(), status = 'completed' WHERE id = $2 AND organisation_id = $1 RETURNING *`,
      [orgId, taskId]
    );
    return rows[0];
  },

  // ---------- Quotes (Devis) ----------
  async createQuote(orgId, { projectId, amount, description }) {
    const { rows } = await db.query(
      `INSERT INTO quotes (organisation_id, project_id, amount, description, status, created_at)
       VALUES ($1, $2, $3, $4, 'draft', NOW()) RETURNING *`,
      [orgId, projectId, amount, description]
    );
    return rows[0];
  },

  // ---------- Invoices (list) ----------
  async getInvoices(orgId) {
    const { rows } = await db.query('SELECT * FROM invoices WHERE organisation_id = $1', [orgId]);
    return rows;
  },

  // ---------- Revenue ----------
  async getRevenue(orgId) {
    const { rows } = await db.query('SELECT COALESCE(SUM(amount),0) AS total FROM invoices WHERE organisation_id = $1', [orgId]);
    return rows[0];
  },

  // ---------- Invoices (from quote) ----------
  async createInvoiceFromQuote(orgId, quoteId) {
    // simple conversion: copy quote data into invoice, set status pending
    const { rows: qRows } = await db.query(
      `SELECT * FROM quotes WHERE id = $2 AND organisation_id = $1`,
      [orgId, quoteId]
    );
    const quote = qRows[0];
    const { rows } = await db.query(
      `INSERT INTO invoices (organisation_id, quote_id, amount, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW()) RETURNING *`,
      [orgId, quoteId, quote.amount]
    );
    return rows[0];
  },

  // ---------- Payments ----------
  async recordPayment(orgId, { invoiceId, amount, provider, transactionId }) {
    const { rows } = await db.query(
      `INSERT INTO payments (organisation_id, invoice_id, amount, provider, transaction_id, paid_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [orgId, invoiceId, amount, provider, transactionId]
    );
    // update invoice status
    await db.query(
      `UPDATE invoices SET status = 'paid' WHERE id = $2 AND organisation_id = $1`,
      [orgId, invoiceId]
    );
    return rows[0];
  }
};
