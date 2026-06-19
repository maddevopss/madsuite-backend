// backend/src/routes/hub.routes.js

/**
 * Express router for the Smart Work‑Flow Hub APIs.
 * All endpoints are protected by auth middleware which populates req.user.id and req.user.organisationId.
 */

const express = require('express');
const router = express.Router();
const hubService = require('../services/hub.service');
const auth = require('../middleware/auth.middleware');

// Apply auth to all hub routes
router.use(auth.requireAuth);

// ---------- Projects ----------
router.get('/projects', async (req, res) => {
  try {
    const projects = await hubService.getProjects(req.user.organisationId);
    res.json(projects);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.post('/projects', async (req, res) => {
  const { name, description } = req.body;
  try {
    const project = await hubService.createProject(req.user.organisationId, { name, description });
    res.status(201).json(project);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// ---------- Tasks (time tracking) ----------
router.post('/tasks/start', async (req, res) => {
  const { projectId, description } = req.body;
  try {
    const task = await hubService.startTask(req.user.organisationId, { projectId, description });
    // Emit socket event for real‑time UI sync
    req.app.get('io').emit('task_started', task);
    res.status(201).json(task);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to start task' });
  }
});

router.post('/tasks/:id/stop', async (req, res) => {
  const taskId = req.params.id;
  try {
    const task = await hubService.stopTask(req.user.organisationId, taskId);
    req.app.get('io').emit('task_stopped', task);
    res.json(task);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to stop task' });
  }
});

// ---------- Quotes (devis) ----------
router.post('/quotes', async (req, res) => {
  const { projectId, amount, description } = req.body;
  try {
    const quote = await hubService.createQuote(req.user.organisationId, { projectId, amount, description });
    req.app.get('io').emit('quote_created', quote);
    res.status(201).json(quote);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create quote' });
  }
});

// ---------- Invoices ----------
router.post('/invoices/from-quote/:quoteId', async (req, res) => {
  const { quoteId } = req.params;
  try {
    const invoice = await hubService.createInvoiceFromQuote(req.user.organisationId, quoteId);
    req.app.get('io').emit('invoice_created', invoice);
    res.status(201).json(invoice);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// ---------- Payments ----------
router.post('/payments', async (req, res) => {
  const { invoiceId, amount, provider, transactionId } = req.body;
  try {
    const payment = await hubService.recordPayment(req.user.organisationId, { invoiceId, amount, provider, transactionId });
    req.app.get('io').emit('payment_recorded', payment);
    res.status(201).json(payment);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

router.get('/invoices', async (req, res) => {
  try {
    const invoices = await hubService.getInvoices(req.user.organisationId);
    res.json(invoices);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

module.exports = router;
