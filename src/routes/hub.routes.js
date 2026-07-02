// backend/src/routes/hub.routes.js

/**
 * Express router for the Smart Work‑Flow Hub APIs.
 * All endpoints are protected by auth middleware which populates req.user.id and req.user.organisation_id.
 *
 * SECURITY FIX (P0-1, P0-2):
 * - req.user.organisationId → req.user.organisation_id (JWT uses snake_case)
 * - io.emit() global → io.of('/hub').to(`org_${orgId}`).emit() (tenant isolation)
 */

const express = require('express');
const router = express.Router();
const hubService = require('../services/hub.service');
const auth = require('../middleware/auth');
const logger = require('../config/logger');

// Apply auth to all hub routes
router.use(auth);

// ---------- Projects ----------
router.get('/projects', async (req, res) => {
  try {
    const projects = await hubService.getProjects(req.user.organisation_id);
    res.json(projects);
  } catch (e) {
    logger.error('Hub GET /projects error', { error: e.message, orgId: req.user?.organisation_id });
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.post('/projects', async (req, res) => {
  const { name, description } = req.body;
  try {
    const project = await hubService.createProject(req.user.organisation_id, { name, description });
    res.status(201).json(project);
  } catch (e) {
    logger.error('Hub POST /projects error', { error: e.message, orgId: req.user?.organisation_id });
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// ---------- Tasks ----------
router.get('/tasks', async (req, res) => {
  try {
    const tasks = await hubService.getTasks(req.user.organisation_id);
    res.json(tasks);
  } catch (e) {
    logger.error('Hub GET /tasks error', { error: e.message, orgId: req.user?.organisation_id });
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// ---------- Quotes ----------
router.get('/quotes', async (req, res) => {
  try {
    const quotes = await hubService.getQuotes(req.user.organisation_id);
    res.json(quotes);
  } catch (e) {
    logger.error('Hub GET /quotes error', { error: e.message, orgId: req.user?.organisation_id });
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// ---------- Invoices ----------
router.get('/invoices', async (req, res) => {
  try {
    const invoices = await hubService.getInvoices(req.user.organisation_id);
    res.json(invoices);
  } catch (e) {
    logger.error('Hub GET /invoices error', { error: e.message, orgId: req.user?.organisation_id });
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// ---------- Payments ----------
router.get('/payments', async (req, res) => {
  try {
    const payments = await hubService.getPayments(req.user.organisation_id);
    res.json(payments);
  } catch (e) {
    logger.error('Hub GET /payments error', { error: e.message, orgId: req.user?.organisation_id });
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// ---------- Tasks (time tracking) ----------
router.post('/tasks/start', async (req, res) => {
  const { projectId, description } = req.body;
  const orgId = req.user.organisation_id;
  try {
    const task = await hubService.startTask(orgId, { projectId, description });
    // Emit socket event scoped to the organisation room only (P0-2 fix)
    req.app.get('io').of('/hub').to(`org_${orgId}`).emit('task_started', task);
    res.status(201).json(task);
  } catch (e) {
    logger.error('Hub POST /tasks/start error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to start task' });
  }
});

router.post('/tasks/:id/stop', async (req, res) => {
  const taskId = req.params.id;
  const orgId = req.user.organisation_id;
  try {
    const task = await hubService.stopTask(orgId, taskId);
    // Emit socket event scoped to the organisation room only (P0-2 fix)
    req.app.get('io').of('/hub').to(`org_${orgId}`).emit('task_stopped', task);
    res.json(task);
  } catch (e) {
    logger.error('Hub POST /tasks/:id/stop error', { error: e.message, orgId, taskId });
    res.status(500).json({ error: 'Failed to stop task' });
  }
});

// ---------- Quotes (devis) ----------
router.post('/quotes', async (req, res) => {
  const { projectId, amount, description } = req.body;
  const orgId = req.user.organisation_id;
  try {
    const quote = await hubService.createQuote(orgId, { projectId, amount, description });
    // Emit socket event scoped to the organisation room only (P0-2 fix)
    req.app.get('io').of('/hub').to(`org_${orgId}`).emit('quote_created', quote);
    res.status(201).json(quote);
  } catch (e) {
    logger.error('Hub POST /quotes error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to create quote' });
  }
});

// ---------- Invoices ----------
router.post('/invoices/from-quote/:quoteId', async (req, res) => {
  const { quoteId } = req.params;
  const orgId = req.user.organisation_id;
  try {
    const invoice = await hubService.createInvoiceFromQuote(orgId, quoteId);
    // Emit socket event scoped to the organisation room only (P0-2 fix)
    req.app.get('io').of('/hub').to(`org_${orgId}`).emit('invoice_created', invoice);
    res.status(201).json(invoice);
  } catch (e) {
    logger.error('Hub POST /invoices/from-quote error', { error: e.message, orgId, quoteId });
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// ---------- Payments ----------
router.post('/payments', async (req, res) => {
  const { invoiceId, amount, provider, transactionId } = req.body;
  const orgId = req.user.organisation_id;
  try {
    const payment = await hubService.recordPayment(orgId, { invoiceId, amount, provider, transactionId });
    // Emit socket event scoped to the organisation room only (P0-2 fix)
    req.app.get('io').of('/hub').to(`org_${orgId}`).emit('payment_recorded', payment);
    res.status(201).json(payment);
  } catch (e) {
    logger.error('Hub POST /payments error', { error: e.message, orgId });
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

module.exports = router;
