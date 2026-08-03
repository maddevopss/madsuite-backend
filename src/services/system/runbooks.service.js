const prisma = require('../../../db');

class RunbooksService {
  async createRunbook(organisationId, runbookData) {
    const {
      name,
      alert_trigger,
      priority = 'high',
      steps = [],
      owner_id,
    } = runbookData;

    if (!name || !steps || steps.length === 0) {
      throw new Error('Runbook requires name and at least one step');
    }

    try {
      const result = await prisma.query(
        `
        INSERT INTO observability.runbooks (
          organisation_id, name, alert_trigger, priority, steps, owner_id
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, priority, version, published_at
        `,
        [
          organisationId,
          name,
          alert_trigger || null,
          priority,
          JSON.stringify(steps),
          owner_id || null,
        ],
      );

      return result.rows[0];
    } catch (error) {
      console.error('Failed to create runbook:', error.message);
      return null;
    }
  }

  async getRunbooks(organisationId, options = {}) {
    const { alert_trigger, active_only = true } = options;

    let query = `
      SELECT id, name, alert_trigger, priority, version, is_active,
             owner_id, published_at, created_at
      FROM observability.runbooks
      WHERE organisation_id = $1 OR organisation_id IS NULL
    `;

    const params = [organisationId];
    let paramIndex = 2;

    if (active_only) {
      query += ` AND is_active = true`;
    }

    if (alert_trigger) {
      query += ` AND alert_trigger = $${paramIndex}`;
      params.push(alert_trigger);
      paramIndex += 1;
    }

    query += ` ORDER BY priority DESC, created_at DESC`;

    try {
      const runbooks = await prisma.query(query, params);
      return runbooks.rows;
    } catch (error) {
      console.error('Failed to fetch runbooks:', error.message);
      return [];
    }
  }

  async getRunbookDetail(runbookId) {
    try {
      const result = await prisma.query(
        `
        SELECT id, name, alert_trigger, priority, steps, owner_id, version,
               is_active, published_at, created_at
        FROM observability.runbooks
        WHERE id = $1
        `,
        [runbookId],
      );

      const runbook = result.rows[0];
      if (runbook) {
        runbook.steps = runbook.steps || [];
      }
      return runbook;
    } catch (error) {
      console.error('Failed to fetch runbook detail:', error.message);
      return null;
    }
  }

  async publishRunbook(runbookId, organisationId) {
    try {
      await prisma.query(
        `
        UPDATE observability.runbooks
        SET is_active = true, published_at = $1
        WHERE id = $2 AND (organisation_id = $3 OR organisation_id IS NULL)
        `,
        [new Date(), runbookId, organisationId],
      );

      return true;
    } catch (error) {
      console.error('Failed to publish runbook:', error.message);
      return false;
    }
  }

  async deprecateRunbook(runbookId) {
    try {
      await prisma.query(
        `
        UPDATE observability.runbooks
        SET is_active = false, deprecated_at = $1
        WHERE id = $2
        `,
        [new Date(), runbookId],
      );

      return true;
    } catch (error) {
      console.error('Failed to deprecate runbook:', error.message);
      return false;
    }
  }

  async startRunbookExecution(runbookId, executedBy, incidentRef = null) {
    try {
      const result = await prisma.query(
        `
        INSERT INTO observability.runbook_executions (
          runbook_id, executed_by, incident_ref, started_at, status
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id, started_at
        `,
        [runbookId, executedBy, incidentRef || null, new Date(), 'in_progress'],
      );

      return result.rows[0];
    } catch (error) {
      console.error('Failed to start runbook execution:', error.message);
      return null;
    }
  }

  async recordRunbookStep(executionId, stepNumber, result) {
    const { completed, duration_ms, output, error } = result;

    try {
      // Get current execution
      const exec = await prisma.query(
        `SELECT steps_executed FROM observability.runbook_executions WHERE id = $1`,
        [executionId],
      );

      const steps = exec.rows[0]?.steps_executed || [];

      // Add/update step
      const existingIndex = steps.findIndex((s) => s.step_num === stepNumber);
      const stepRecord = {
        step_num: stepNumber,
        completed,
        duration_ms,
        output: output || null,
        error: error || null,
        recorded_at: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        steps[existingIndex] = stepRecord;
      } else {
        steps.push(stepRecord);
      }

      // Update execution
      await prisma.query(
        `
        UPDATE observability.runbook_executions
        SET steps_executed = $1
        WHERE id = $2
        `,
        [JSON.stringify(steps), executionId],
      );

      return true;
    } catch (error) {
      console.error('Failed to record runbook step:', error.message);
      return false;
    }
  }

  async completeRunbookExecution(executionId, status = 'success') {
    if (!['success', 'partial', 'failed'].includes(status)) {
      throw new Error('Invalid status');
    }

    try {
      await prisma.query(
        `
        UPDATE observability.runbook_executions
        SET status = $1, completed_at = $2
        WHERE id = $3
        `,
        [status, new Date(), executionId],
      );

      return true;
    } catch (error) {
      console.error('Failed to complete execution:', error.message);
      return false;
    }
  }

  async createRCARecord(organisationId, rcaData) {
    const {
      title,
      description,
      start_time,
      severity = 'high',
      facilitator_id,
    } = rcaData;

    if (!title || !start_time) {
      throw new Error('RCA requires title and start_time');
    }

    try {
      // Generate incident number
      const lastInc = await prisma.query(
        `
        SELECT incident_number FROM observability.incident_rca
        WHERE organisation_id = $1
        ORDER BY incident_number DESC LIMIT 1
        `,
        [organisationId],
      );

      let nextNumber = 1;
      if (lastInc.rows[0]) {
        const match = lastInc.rows[0].incident_number.match(/(\d+)$/);
        if (match) {
          nextNumber = parseInt(match[1]) + 1;
        }
      }

      const incidentNumber = `INC-${String(nextNumber).padStart(4, '0')}`;

      const result = await prisma.query(
        `
        INSERT INTO observability.incident_rca (
          organisation_id, incident_number, title, description,
          start_time, severity, facilitator_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, incident_number, title, severity, status
        `,
        [organisationId, incidentNumber, title, description, start_time, severity, facilitator_id || null, 'open'],
      );

      return result.rows[0];
    } catch (error) {
      console.error('Failed to create RCA record:', error.message);
      return null;
    }
  }

  async updateRCATimeline(rcaId, timelineEvent) {
    const { time, event, actor, details } = timelineEvent;

    try {
      const rca = await prisma.query(
        `SELECT timeline FROM observability.incident_rca WHERE id = $1`,
        [rcaId],
      );

      const timeline = rca.rows[0]?.timeline || [];

      timeline.push({
        time: time || new Date().toISOString(),
        event,
        actor: actor || null,
        details: details || null,
      });

      await prisma.query(
        `
        UPDATE observability.incident_rca
        SET timeline = $1, updated_at = $2
        WHERE id = $3
        `,
        [JSON.stringify(timeline), new Date(), rcaId],
      );

      return true;
    } catch (error) {
      console.error('Failed to update timeline:', error.message);
      return false;
    }
  }

  async addRCAAction(rcaId, action) {
    const { description, owner, due_date } = action;

    try {
      const rca = await prisma.query(
        `SELECT actions FROM observability.incident_rca WHERE id = $1`,
        [rcaId],
      );

      const actions = rca.rows[0]?.actions || [];

      const actionRecord = {
        action_id: `ACT-${Date.now()}`,
        description,
        owner: owner || null,
        due_date: due_date || null,
        status: 'open',
        created_at: new Date().toISOString(),
      };

      actions.push(actionRecord);

      await prisma.query(
        `
        UPDATE observability.incident_rca
        SET actions = $1, updated_at = $2
        WHERE id = $3
        `,
        [JSON.stringify(actions), new Date(), rcaId],
      );

      return actionRecord;
    } catch (error) {
      console.error('Failed to add RCA action:', error.message);
      return null;
    }
  }

  async closeRCA(rcaId, organisationId) {
    try {
      await prisma.query(
        `
        UPDATE observability.incident_rca
        SET status = $1, published_at = $2, updated_at = $3
        WHERE id = $4 AND organisation_id = $5
        `,
        ['closed', new Date(), new Date(), rcaId, organisationId],
      );

      return true;
    } catch (error) {
      console.error('Failed to close RCA:', error.message);
      return false;
    }
  }

  async getRCARecords(organisationId, options = {}) {
    const { status, severity, limit = 50, offset = 0 } = options;

    let query = `
      SELECT id, incident_number, title, severity, status,
             start_time, resolution_time, created_at
      FROM observability.incident_rca
      WHERE organisation_id = $1
    `;

    const params = [organisationId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex += 1;
    }

    if (severity) {
      query += ` AND severity = $${paramIndex}`;
      params.push(severity);
      paramIndex += 1;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    try {
      const records = await prisma.query(query, params);
      return records.rows;
    } catch (error) {
      console.error('Failed to fetch RCA records:', error.message);
      return [];
    }
  }

  async getRCADetail(rcaId, organisationId) {
    try {
      const result = await prisma.query(
        `
        SELECT id, incident_number, title, description, severity, status,
               start_time, detection_time, resolution_time,
               root_cause, contributing_factors, impact_summary, lessons_learned,
               timeline, actions, facilitator_id, participants,
               created_at, published_at
        FROM observability.incident_rca
        WHERE id = $1 AND organisation_id = $2
        `,
        [rcaId, organisationId],
      );

      const rca = result.rows[0];
      if (rca) {
        rca.timeline = rca.timeline || [];
        rca.actions = rca.actions || [];
      }
      return rca;
    } catch (error) {
      console.error('Failed to fetch RCA detail:', error.message);
      return null;
    }
  }

  async getRunbookExecutions(runbookId, options = {}) {
    const { limit = 20 } = options;

    try {
      const executions = await prisma.query(
        `
        SELECT id, executed_by, incident_ref, started_at, completed_at,
               status, steps_executed
        FROM observability.runbook_executions
        WHERE runbook_id = $1
        ORDER BY started_at DESC
        LIMIT $2
        `,
        [runbookId, limit],
      );

      return executions.rows.map((e) => ({
        ...e,
        steps_executed: e.steps_executed || [],
      }));
    } catch (error) {
      console.error('Failed to fetch executions:', error.message);
      return [];
    }
  }
}

module.exports = new RunbooksService();
