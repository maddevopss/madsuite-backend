// backend/src/routes/hub.routes.js

/**
 * Express router for the Smart Work‑Flow Hub APIs.
 * All endpoints are protected by auth middleware and canonical organisation context.
 *
 * SECURITY FIX (P0-1, P0-2):
 * - req.user.organisationId → req.user.organisation_id (JWT uses snake_case)
 * - io.emit() global → io.of('/hub').to(`org_${orgId}`).emit() (tenant isolation)
 *
 * SECURITY FIX (P0-3):
 * - Require the canonical organisation middleware for every Hub endpoint.
 * - This binds req.db and db.query() to the request-scoped RLS transaction.
 */

const express = require('express');
const router = express.Router();
const hubService = require('../services/hub.service');
const auth = require('../middleware/auth');
const { requireOrganisation } = require('../middleware/organization.middleware');
const { getOrganisationId } = require('../utils/organisationScope');
const logger = require('../config/logger');

// Apply auth + request-scoped organisation/RLS context to all hub routes.
router.use(auth);
router.use(requireOrganisation);

function emitHubEvent(req, orgId, eventName, payload) {
  req.app.get('io').of('/hub').to(`org_${orgId}`).emit(eventName, payload);
}

// ---------- Projects ----------
router.get('/projects', async (req, res) => {
  const orgId = getOrganisationId(req);
  try {
    const projects = await hubService.getProjects(orgId);
    res.json(projects);
  } catch (e) {
    logger.error('Hub GET /projects error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.post('/projects', async (req, res) => {
  const { name, description } = req.body;
  const orgId = getOrganisationId(req);
  try {
    const project = await hubService.createProject(orgId, { name, description });
    res.status(201).json(project);
  } catch (e) {
    logger.error('Hub POST /projects error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// ---------- Tasks ----------
router.get('/tasks', async (req, res) => {
  const orgId = getOrganisationId(req);
  try {
    const tasks = await hubService.getTasks(orgId);
    res.json(tasks);
  } catch (e) {
    logger.error('Hub GET /tasks error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// ---------- Quotes ----------
router.get('/quotes', async (req, res) => {
  const orgId = getOrganisationId(req);
  try {
    const quotes = await hubService.getQuotes(orgId);
    res.json(quotes);
  } catch (e) {
    logger.error('Hub GET /quotes error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// ---------- Invoices ----------
router.get('/invoices', async (req, res) => {
  const orgId = getOrganisationId(req);
  try {
    const invoices = await hubService.getInvoices(orgId);
    res.json(invoices);
  } catch (e) {
    logger.error('Hub GET /invoices error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// ---------- Payments ----------
router.get('/payments', async (req, res) => {
  const orgId = getOrganisationId(req);
  try {
    const payments = await hubService.getPayments(orgId);
    res.json(payments);
  } catch (e) {
    logger.error('Hub GET /payments error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// ---------- Tasks (time tracking) ----------
router.post('/tasks/start', async (req, res) => {
  const { projectId, description } = req.body;
  const orgId = getOrganisationId(req);
  try {
    const task = await hubService.startTask(orgId, { projectId, description });
    emitHubEvent(req, orgId, 'task_started', task);
    res.status(201).json(task);
  } catch (e) {
    logger.error('Hub POST /tasks/start error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to start task' });
  }
});

router.post('/tasks/:id/stop', async (req, res) => {
  const taskId = req.params.id;
  const orgId = getOrganisationId(req);
  try {
    const task = await hubService.stopTask(orgId, taskId);
    emitHubEvent(req, orgId, 'task_stopped', task);
    res.json(task);
  } catch (e) {
    logger.error('Hub POST /tasks/:id/stop error', { error: e.message, orgId, taskId });
    res.status(500).json({ error: 'Failed to stop task' });
  }
});

// ---------- Quotes (devis) ----------
router.post('/quotes', async (req, res) => {
  const { projectId, amount, description } = req.body;
  const orgId = getOrganisationId(req);
  try {
    const quote = await hubService.createQuote(orgId, { projectId, amount, description });
    emitHubEvent(req, orgId, 'quote_created', quote);
    res.status(201).json(quote);
  } catch (e) {
    logger.error('Hub POST /quotes error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to create quote' });
  }
});

// ---------- Invoices ----------
router.post('/invoices/from-quote/:quoteId', async (req, res) => {
  const { quoteId } = req.params;
  const orgId = getOrganisationId(req);
  try {
    const invoice = await hubService.createInvoiceFromQuote(orgId, quoteId);
    emitHubEvent(req, orgId, 'invoice_created', invoice);
    res.status(201).json(invoice);
  } catch (e) {
    logger.error('Hub POST /invoices/from-quote error', { error: e.message, orgId, quoteId });
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// ---------- Payments ----------
router.post('/payments', async (req, res) => {
  const { invoiceId, amount, provider, transactionId } = req.body;
  const orgId = getOrganisationId(req);
  try {
    const payment = await hubService.recordPayment(orgId, { invoiceId, amount, provider, transactionId });
    emitHubEvent(req, orgId, 'payment_recorded', payment);
    res.status(201).json(payment);
  } catch (e) {
    logger.error('Hub POST /payments error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

module.exports = router;
