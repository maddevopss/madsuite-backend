const express = require('express');
const runbooksService = require('../services/system/runbooks.service');

const createRunbooksRoutes = () => {
  const router = express.Router();

  // POST /runbooks - Create runbook
  router.post('/runbooks', async (req, res) => {
    const { name, alert_trigger, priority = 'high', steps } = req.body;
    const organisationId = req.organisationId;
    const userId = req.user?.id;

    if (!name || !steps || steps.length === 0) {
      return res.status(400).json({ error: 'Required: name, steps (non-empty array)' });
    }

    try {
      const runbook = await runbooksService.createRunbook(organisationId, {
        name,
        alert_trigger,
        priority,
        steps,
        owner_id: userId,
      });

      res.status(201).json(runbook);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /runbooks - List runbooks
  router.get('/runbooks', async (req, res) => {
    const { alert_trigger, active_only = true } = req.query;
    const organisationId = req.organisationId;

    try {
      const runbooks = await runbooksService.getRunbooks(organisationId, {
        alert_trigger,
        active_only: active_only === 'true',
      });

      res.json({ runbooks, count: runbooks.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /runbooks/:runbookId - Get runbook details
  router.get('/runbooks/:runbookId', async (req, res) => {
    const { runbookId } = req.params;

    try {
      const runbook = await runbooksService.getRunbookDetail(runbookId);

      if (!runbook) {
        return res.status(404).json({ error: 'Runbook not found' });
      }

      res.json(runbook);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /runbooks/:runbookId/execute - Start execution
  router.post('/runbooks/:runbookId/execute', async (req, res) => {
    const { runbookId } = req.params;
    const { incident_ref } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    try {
      const execution = await runbooksService.startRunbookExecution(runbookId, userId, incident_ref);

      if (!execution) {
        return res.status(400).json({ error: 'Failed to start execution' });
      }

      res.status(201).json(execution);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /runbooks/executions/:executionId/step - Record step result
  router.post('/runbooks/executions/:executionId/step', async (req, res) => {
    const { executionId } = req.params;
    const { step_number, completed, duration_ms, output, error } = req.body;

    if (step_number === undefined || completed === undefined) {
      return res.status(400).json({ error: 'Required: step_number, completed' });
    }

    try {
      const success = await runbooksService.recordRunbookStep(executionId, step_number, {
        completed,
        duration_ms,
        output,
        error,
      });

      res.json({ success });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /runbooks/executions/:executionId/complete - Complete execution
  router.post('/runbooks/executions/:executionId/complete', async (req, res) => {
    const { executionId } = req.params;
    const { status = 'success' } = req.body;

    try {
      const success = await runbooksService.completeRunbookExecution(executionId, status);
      res.json({ success });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /incidents/rca - Create RCA record
  router.post('/incidents/rca', async (req, res) => {
    const { title, description, start_time, severity = 'high' } = req.body;
    const organisationId = req.organisationId;
    const userId = req.user?.id;

    if (!title || !start_time) {
      return res.status(400).json({ error: 'Required: title, start_time' });
    }

    try {
      const rca = await runbooksService.createRCARecord(organisationId, {
        title,
        description,
        start_time,
        severity,
        facilitator_id: userId,
      });

      if (!rca) {
        return res.status(400).json({ error: 'Failed to create RCA' });
      }

      res.status(201).json(rca);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /incidents/rca - List RCA records
  router.get('/incidents/rca', async (req, res) => {
    const { status, severity, limit = 50, offset = 0 } = req.query;
    const organisationId = req.organisationId;

    try {
      const records = await runbooksService.getRCARecords(organisationId, {
        status,
        severity,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });

      res.json({ records, count: records.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /incidents/rca/:rcaId - Get RCA details
  router.get('/incidents/rca/:rcaId', async (req, res) => {
    const { rcaId } = req.params;
    const organisationId = req.organisationId;

    try {
      const rca = await runbooksService.getRCADetail(rcaId, organisationId);

      if (!rca) {
        return res.status(404).json({ error: 'RCA not found' });
      }

      res.json(rca);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /incidents/rca/:rcaId/timeline - Add timeline event
  router.post('/incidents/rca/:rcaId/timeline', async (req, res) => {
    const { rcaId } = req.params;
    const { time, event, actor, details } = req.body;
    const userId = req.user?.id;

    if (!event) {
      return res.status(400).json({ error: 'Required: event' });
    }

    try {
      const success = await runbooksService.updateRCATimeline(rcaId, {
        time,
        event,
        actor: actor || userId,
        details,
      });

      res.json({ success });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /incidents/rca/:rcaId/actions - Add corrective action
  router.post('/incidents/rca/:rcaId/actions', async (req, res) => {
    const { rcaId } = req.params;
    const { description, owner, due_date } = req.body;

    if (!description) {
      return res.status(400).json({ error: 'Required: description' });
    }

    try {
      const action = await runbooksService.addRCAAction(rcaId, {
        description,
        owner,
        due_date,
      });

      res.status(201).json(action);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /incidents/rca/:rcaId/close - Close RCA
  router.post('/incidents/rca/:rcaId/close', async (req, res) => {
    const { rcaId } = req.params;
    const organisationId = req.organisationId;

    try {
      const success = await runbooksService.closeRCA(rcaId, organisationId);
      res.json({ success });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /runbooks/:runbookId/executions - Execution history
  router.get('/runbooks/:runbookId/executions', async (req, res) => {
    const { runbookId } = req.params;
    const { limit = 20 } = req.query;

    try {
      const executions = await runbooksService.getRunbookExecutions(runbookId, {
        limit: parseInt(limit),
      });

      res.json({ executions, count: executions.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

module.exports = {
  createRunbooksRoutes,
};
