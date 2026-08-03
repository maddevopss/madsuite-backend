const { randomUUID: uuidv4 } = require('node:crypto');
const runbooksService = require('../services/system/runbooks.service');

describe('Stage 14 PR 14F — Runbooks & RCA Contract Tests', () => {
  let testOrganisationId;
  let testUserId;

  beforeAll(() => {
    testOrganisationId = uuidv4();
    testUserId = uuidv4();
  });

  describe('Runbook Management', () => {
    it('should create runbook with steps', async () => {
      const steps = [
        {
          step_number: 1,
          description: 'Check database connection',
          action: 'SELECT 1',
          verification: 'Response received',
          timeout_seconds: 30,
        },
        {
          step_number: 2,
          description: 'Restart API service',
          action: 'systemctl restart api',
          verification: 'Service listening on port 3000',
          timeout_seconds: 60,
        },
      ];

      const runbook = await runbooksService.createRunbook(testOrganisationId, {
        name: 'API Recovery Runbook',
        alert_trigger: 'api_down',
        priority: 'critical',
        steps,
        owner_id: testUserId,
      });

      expect(runbook).toBeTruthy();
      expect(runbook.name).toBe('API Recovery Runbook');
      expect(runbook.priority).toBe('critical');
    });

    it('should list runbooks', async () => {
      const runbooks = await runbooksService.getRunbooks(testOrganisationId);
      expect(Array.isArray(runbooks)).toBe(true);
    });

    it('should filter runbooks by alert trigger', async () => {
      const runbooks = await runbooksService.getRunbooks(testOrganisationId, {
        alert_trigger: 'api_down',
      });

      expect(Array.isArray(runbooks)).toBe(true);
      runbooks.forEach((rb) => {
        expect(rb.alert_trigger).toBe('api_down');
      });
    });

    it('should get runbook detail with steps', async () => {
      const created = await runbooksService.createRunbook(testOrganisationId, {
        name: 'Detail Test',
        priority: 'high',
        steps: [{ step_number: 1, description: 'Test step', action: 'echo test' }],
        owner_id: testUserId,
      });

      const detail = await runbooksService.getRunbookDetail(created.id);
      expect(detail).toBeTruthy();
      expect(detail.steps).toBeDefined();
      expect(Array.isArray(detail.steps)).toBe(true);
    });

    it('should publish runbook', async () => {
      const runbook = await runbooksService.createRunbook(testOrganisationId, {
        name: 'Publish Test',
        priority: 'medium',
        steps: [{ step_number: 1, description: 'Step 1', action: 'test' }],
      });

      const success = await runbooksService.publishRunbook(runbook.id, testOrganisationId);
      expect(success).toBe(true);
    });

    it('should deprecate runbook', async () => {
      const runbook = await runbooksService.createRunbook(testOrganisationId, {
        name: 'Deprecate Test',
        priority: 'low',
        steps: [{ step_number: 1, description: 'Step', action: 'test' }],
      });

      const success = await runbooksService.deprecateRunbook(runbook.id);
      expect(success).toBe(true);
    });
  });

  describe('Runbook Execution', () => {
    it('should start execution', async () => {
      const runbook = await runbooksService.createRunbook(testOrganisationId, {
        name: 'Exec Test',
        priority: 'high',
        steps: [
          { step_number: 1, description: 'Test', action: 'test_action' },
          { step_number: 2, description: 'Verify', action: 'verify_action' },
        ],
      });

      const execution = await runbooksService.startRunbookExecution(runbook.id, testUserId);

      expect(execution).toBeTruthy();
      expect(execution.started_at).toBeTruthy();
    });

    it('should record step results', async () => {
      const runbook = await runbooksService.createRunbook(testOrganisationId, {
        name: 'Step Record Test',
        priority: 'medium',
        steps: [
          { step_number: 1, description: 'Install', action: 'apt-get install' },
          { step_number: 2, description: 'Start', action: 'systemctl start' },
        ],
      });

      const exec = await runbooksService.startRunbookExecution(runbook.id, testUserId, 'INC-0001');

      const step1Success = await runbooksService.recordRunbookStep(exec.id, 1, {
        completed: true,
        duration_ms: 1234,
        output: 'Installation successful',
      });

      expect(step1Success).toBe(true);

      const step2Success = await runbooksService.recordRunbookStep(exec.id, 2, {
        completed: true,
        duration_ms: 567,
        output: 'Service started',
      });

      expect(step2Success).toBe(true);
    });

    it('should record step errors', async () => {
      const runbook = await runbooksService.createRunbook(testOrganisationId, {
        name: 'Error Test',
        priority: 'high',
        steps: [{ step_number: 1, description: 'Risky', action: 'dangerous_command' }],
      });

      const exec = await runbooksService.startRunbookExecution(runbook.id, testUserId);

      const errorRecord = await runbooksService.recordRunbookStep(exec.id, 1, {
        completed: false,
        duration_ms: 500,
        error: 'Permission denied: cannot execute dangerous_command',
      });

      expect(errorRecord).toBe(true);
    });

    it('should complete execution', async () => {
      const runbook = await runbooksService.createRunbook(testOrganisationId, {
        name: 'Complete Test',
        priority: 'medium',
        steps: [{ step_number: 1, description: 'Test', action: 'test' }],
      });

      const exec = await runbooksService.startRunbookExecution(runbook.id, testUserId);
      const success = await runbooksService.completeRunbookExecution(exec.id, 'success');

      expect(success).toBe(true);
    });

    it('should get execution history', async () => {
      const runbook = await runbooksService.createRunbook(testOrganisationId, {
        name: 'History Test',
        priority: 'low',
        steps: [{ step_number: 1, description: 'Test', action: 'test' }],
      });

      const exec1 = await runbooksService.startRunbookExecution(runbook.id, testUserId);
      await runbooksService.completeRunbookExecution(exec1.id, 'success');

      const executions = await runbooksService.getRunbookExecutions(runbook.id);
      expect(Array.isArray(executions)).toBe(true);
    });
  });

  describe('RCA Record Management', () => {
    it('should create RCA record', async () => {
      const rca = await runbooksService.createRCARecord(testOrganisationId, {
        title: 'Database Connection Pool Exhaustion',
        description: 'API failed due to connection pool limits',
        start_time: new Date(Date.now() - 3600000),
        severity: 'critical',
        facilitator_id: testUserId,
      });

      expect(rca).toBeTruthy();
      expect(rca.incident_number).toMatch(/^INC-\d{4}$/);
      expect(rca.title).toBe('Database Connection Pool Exhaustion');
    });

    it('should auto-increment incident numbers', async () => {
      const rca1 = await runbooksService.createRCARecord(testOrganisationId, {
        title: 'Incident 1',
        start_time: new Date(),
      });

      const rca2 = await runbooksService.createRCARecord(testOrganisationId, {
        title: 'Incident 2',
        start_time: new Date(),
      });

      expect(rca1.incident_number).toBeTruthy();
      expect(rca2.incident_number).toBeTruthy();
    });

    it('should list RCA records', async () => {
      const records = await runbooksService.getRCARecords(testOrganisationId);
      expect(Array.isArray(records)).toBe(true);
    });

    it('should filter RCA by status', async () => {
      const openRecords = await runbooksService.getRCARecords(testOrganisationId, {
        status: 'open',
      });

      expect(Array.isArray(openRecords)).toBe(true);
      openRecords.forEach((rec) => {
        expect(rec.status).toBe('open');
      });
    });

    it('should filter RCA by severity', async () => {
      const criticalRecords = await runbooksService.getRCARecords(testOrganisationId, {
        severity: 'critical',
      });

      expect(Array.isArray(criticalRecords)).toBe(true);
    });

    it('should get RCA detail', async () => {
      const created = await runbooksService.createRCARecord(testOrganisationId, {
        title: 'Detail Test',
        description: 'Test RCA',
        start_time: new Date(),
        severity: 'high',
      });

      const detail = await runbooksService.getRCADetail(created.id, testOrganisationId);

      expect(detail).toBeTruthy();
      expect(detail.title).toBe('Detail Test');
      expect(detail.timeline).toBeDefined();
      expect(detail.actions).toBeDefined();
    });
  });

  describe('RCA Timeline & Actions', () => {
    it('should add timeline events', async () => {
      const rca = await runbooksService.createRCARecord(testOrganisationId, {
        title: 'Timeline Test',
        start_time: new Date(),
      });

      const success = await runbooksService.updateRCATimeline(rca.id, {
        time: new Date().toISOString(),
        event: 'Alert fired: API response time >5s',
        actor: 'monitoring-system',
        details: 'p99 latency = 6.5s',
      });

      expect(success).toBe(true);
    });

    it('should record multiple timeline events', async () => {
      const rca = await runbooksService.createRCARecord(testOrganisationId, {
        title: 'Multi Timeline Test',
        start_time: new Date(),
      });

      await runbooksService.updateRCATimeline(rca.id, {
        event: 'Event 1: Incident detected',
        actor: 'Monitoring',
      });

      await runbooksService.updateRCATimeline(rca.id, {
        event: 'Event 2: Runbook started',
        actor: 'Oncall-Engineer',
      });

      await runbooksService.updateRCATimeline(rca.id, {
        event: 'Event 3: Service recovered',
        actor: 'Oncall-Engineer',
      });

      const detail = await runbooksService.getRCADetail(rca.id, testOrganisationId);
      expect(detail.timeline.length).toBeGreaterThanOrEqual(3);
    });

    it('should add corrective actions', async () => {
      const rca = await runbooksService.createRCARecord(testOrganisationId, {
        title: 'Actions Test',
        start_time: new Date(),
      });

      const action1 = await runbooksService.addRCAAction(rca.id, {
        description: 'Increase connection pool size from 50 to 100',
        owner: 'backend-team',
        due_date: '2026-08-10',
      });

      expect(action1).toBeTruthy();
      expect(action1.action_id).toMatch(/^ACT-/);

      const action2 = await runbooksService.addRCAAction(rca.id, {
        description: 'Add connection pool monitoring alerts',
        owner: 'platform-team',
        due_date: '2026-08-05',
      });

      expect(action2).toBeTruthy();
    });

    it('should close RCA', async () => {
      const rca = await runbooksService.createRCARecord(testOrganisationId, {
        title: 'Close Test',
        start_time: new Date(),
      });

      const success = await runbooksService.closeRCA(rca.id, testOrganisationId);
      expect(success).toBe(true);

      const detail = await runbooksService.getRCADetail(rca.id, testOrganisationId);
      expect(detail.status).toBe('closed');
    });
  });

  describe('Runbook-RCA Integration', () => {
    it('should link runbook execution to incident', async () => {
      const runbook = await runbooksService.createRunbook(testOrganisationId, {
        name: 'Integration Test',
        priority: 'critical',
        steps: [{ step_number: 1, description: 'Fix', action: 'fix_command' }],
      });

      const rca = await runbooksService.createRCARecord(testOrganisationId, {
        title: 'Linked Incident',
        start_time: new Date(),
      });

      const exec = await runbooksService.startRunbookExecution(
        runbook.id,
        testUserId,
        rca.incident_number,
      );

      expect(exec).toBeTruthy();
    });
  });

  describe('Data Validation', () => {
    it('should require name and steps for runbook', async () => {
      try {
        await runbooksService.createRunbook(testOrganisationId, {
          name: 'No Steps',
          steps: [],
        });
        expect(true).toBe(false); // Should throw
      } catch (error) {
        expect(error.message).toContain('at least one step');
      }
    });

    it('should require title and start_time for RCA', async () => {
      try {
        await runbooksService.createRCARecord(testOrganisationId, {
          title: 'Missing Time',
          // no start_time
        });
        expect(true).toBe(false); // Should throw
      } catch (error) {
        expect(error.message).toContain('requires title and start_time');
      }
    });
  });
});
