/**
 * Issue #173 PR B: Job Registry Integration Tests
 *
 * Validates:
 * 1. Job registration and metadata
 * 2. Job queries by criticality, owner, tags
 * 3. Job status updates
 * 4. Overdue detection
 * 5. Health status calculation
 * 6. Owner tracking and notifications
 * 7. Retry policy configuration
 * 8. SLA tracking
 */

const db = require("../../db");
const {
  JOB_DEFINITIONS,
  registerAllJobs,
  registerJob,
  getAllJobs,
  getJob,
  updateJobStatus,
  isJobOverdue,
  getJobsByCriticality,
  getJobsByOwner,
  getJobsWithTag,
  getJobsHealth
} = require("../config/jobRegistry");

describe("PR B: Job Registry", () => {
  let client;

  beforeAll(async () => {
    client = await db.pool.connect();
  });

  afterAll(async () => {
    if (client) {
      // Clean up test jobs
      await client.query(`DELETE FROM job_registry WHERE job_name LIKE 'test_%'`);
      await client.query(`DELETE FROM job_lock_tracking WHERE job_name LIKE 'test_%'`);
      await client.query(`DELETE FROM job_sla_metrics WHERE job_name LIKE 'test_%'`);
      client.release();
    }
  });

  describe("Job registry schema", () => {
    it("should have job_registry table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'job_registry'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have job_lock_tracking table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'job_lock_tracking'
      `);
      expect(result.rows.length).toBe(1);
    });

    it("should have job_sla_metrics table", async () => {
      const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'job_sla_metrics'
      `);
      expect(result.rows.length).toBe(1);
    });
  });

  describe("Job registration", () => {
    it("should register a job with all metadata", async () => {
      const jobDef = {
        displayName: "Test Job",
        description: "A test job",
        ownerTeam: "test-team",
        ownerContactEmail: "test@example.com",
        ownerSlackChannel: "#test",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600,
        criticality: "MEDIUM",
        tags: ["test"],
        retryPolicy: { strategy: "exponential", maxAttempts: 3 }
      };

      await registerJob("test_job_1", jobDef, client);

      const job = await getJob("test_job_1");
      expect(job).toBeDefined();
      expect(job.display_name).toBe("Test Job");
      expect(job.owner_team).toBe("test-team");
      expect(job.cron_expression).toBe("0 * * * *");
      expect(job.criticality).toBe("MEDIUM");
      expect(job.enabled).toBe(true);
    });

    it("should update job on re-registration", async () => {
      const job1 = {
        displayName: "Original Name",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600
      };

      await registerJob("test_update_job", job1, client);

      const job2 = {
        displayName: "Updated Name",
        cronExpression: "*/30 * * * *",
        frequencyHours: 0.5,
        timeoutSeconds: 600,
        maxDelaySeconds: 1800
      };

      await registerJob("test_update_job", job2, client);

      const updated = await getJob("test_update_job");
      expect(updated.display_name).toBe("Updated Name");
      expect(updated.cron_expression).toBe("*/30 * * * *");
    });

    it("should enforce unique job names", async () => {
      const jobDef = {
        displayName: "Job A",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600
      };

      await registerJob("test_unique", jobDef, client);

      // Should update, not fail
      await registerJob("test_unique", { ...jobDef, displayName: "Job B" }, client);

      const job = await getJob("test_unique");
      expect(job.display_name).toBe("Job B");
    });
  });

  describe("Job metadata validation", () => {
    it("should validate criticality levels", async () => {
      const validCriticalities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

      for (const crit of validCriticalities) {
        const jobDef = {
          displayName: `Job ${crit}`,
          cronExpression: "0 * * * *",
          frequencyHours: 1,
          timeoutSeconds: 300,
          maxDelaySeconds: 3600,
          criticality: crit
        };

        await registerJob(`test_criticality_${crit}`, jobDef, client);

        const job = await getJob(`test_criticality_${crit}`);
        expect(job.criticality).toBe(crit);
      }
    });

    it("should store retry policy as JSON", async () => {
      const retryPolicy = {
        strategy: "exponential",
        maxAttempts: 5,
        backoffSeconds: 60
      };

      const jobDef = {
        displayName: "Retry Policy Job",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600,
        retryPolicy
      };

      await registerJob("test_retry_policy", jobDef, client);

      const job = await getJob("test_retry_policy");
      expect(job.retry_policy).toBeDefined();
      expect(job.retry_policy.strategy).toBe("exponential");
      expect(job.retry_policy.maxAttempts).toBe(5);
    });

    it("should store tags as array", async () => {
      const jobDef = {
        displayName: "Tagged Job",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600,
        tags: ["analytics", "billing", "critical"]
      };

      await registerJob("test_tags", jobDef, client);

      const job = await getJob("test_tags");
      expect(Array.isArray(job.tags)).toBe(true);
      expect(job.tags).toContain("analytics");
      expect(job.tags).toContain("billing");
    });
  });

  describe("Job status tracking", () => {
    it("should update job status to STARTED", async () => {
      const jobDef = {
        displayName: "Status Test",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600
      };

      await registerJob("test_status_started", jobDef, client);
      await updateJobStatus("test_status_started", "STARTED");

      const job = await getJob("test_status_started");
      expect(job.last_status).toBe("STARTED");
      expect(job.last_started_at).toBeDefined();
    });

    it("should update job status to SUCCESS and reset failures", async () => {
      const jobDef = {
        displayName: "Success Test",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600
      };

      await registerJob("test_status_success", jobDef, client);

      // Simulate failures
      await updateJobStatus("test_status_success", "FAILED");
      await updateJobStatus("test_status_success", "FAILED");

      let job = await getJob("test_status_success");
      expect(job.consecutive_failures).toBe(2);

      // Mark as success
      await updateJobStatus("test_status_success", "SUCCESS");

      job = await getJob("test_status_success");
      expect(job.last_status).toBe("SUCCESS");
      expect(job.consecutive_failures).toBe(0);
    });

    it("should track error messages on failure", async () => {
      const jobDef = {
        displayName: "Error Test",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600
      };

      await registerJob("test_status_error", jobDef, client);
      await updateJobStatus("test_status_error", "FAILED", { errorMessage: "Database connection timeout" });

      const job = await getJob("test_status_error");
      expect(job.last_status).toBe("FAILED");
      expect(job.last_error_message).toBe("Database connection timeout");
    });
  });

  describe("Job queries", () => {
    beforeAll(async () => {
      // Set up test jobs with different properties
      await registerJob("test_query_high_security", {
        displayName: "High Priority Security",
        cronExpression: "*/10 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 600,
        criticality: "CRITICAL",
        ownerTeam: "security",
        tags: ["security"]
      }, client);

      await registerJob("test_query_medium_billing", {
        displayName: "Medium Priority Billing",
        cronExpression: "0 8 * * *",
        frequencyHours: 24,
        timeoutSeconds: 600,
        maxDelaySeconds: 3600,
        criticality: "MEDIUM",
        ownerTeam: "billing",
        tags: ["billing"]
      }, client);

      await registerJob("test_query_low_cleanup", {
        displayName: "Low Priority Cleanup",
        cronExpression: "0 3 * * *",
        frequencyHours: 24,
        timeoutSeconds: 1800,
        maxDelaySeconds: 86400,
        criticality: "LOW",
        ownerTeam: "platform",
        tags: ["maintenance"]
      }, client);
    });

    it("should query all jobs", async () => {
      const jobs = await getAllJobs();

      expect(Array.isArray(jobs)).toBe(true);
      expect(jobs.length).toBeGreaterThan(0);
    });

    it("should query jobs by criticality", async () => {
      const critical = await getJobsByCriticality("CRITICAL");

      expect(critical.length).toBeGreaterThan(0);
      expect(critical.every(j => j.criticality === "CRITICAL")).toBe(true);
    });

    it("should query jobs by owner team", async () => {
      const securityJobs = await getJobsByOwner("security");

      expect(securityJobs.length).toBeGreaterThan(0);
      expect(securityJobs.every(j => j.owner_team === "security")).toBe(true);
    });

    it("should query jobs by tag", async () => {
      const securityJobs = await getJobsWithTag("security");

      expect(securityJobs.length).toBeGreaterThan(0);
      expect(securityJobs.some(j => j.tags.includes("security"))).toBe(true);
    });

    it("should filter jobs by enabled status", async () => {
      const enabledJobs = await getAllJobs({ enabled: true });

      expect(enabledJobs.length).toBeGreaterThan(0);
      expect(enabledJobs.every(j => j.enabled === true)).toBe(true);
    });
  });

  describe("Job overdue detection", () => {
    it("should detect overdue jobs", async () => {
      const jobDef = {
        displayName: "Overdue Test",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 60  // 60 seconds SLA
      };

      await registerJob("test_overdue", jobDef, client);

      // Update with old timestamp
      await client.query(
        `UPDATE job_registry SET last_completed_at = CURRENT_TIMESTAMP - INTERVAL '2 hours'
         WHERE job_name = $1`,
        ["test_overdue"]
      );

      const job = await getJob("test_overdue");
      expect(isJobOverdue(job)).toBe(true);
    });

    it("should not flag recent jobs as overdue", async () => {
      const jobDef = {
        displayName: "Recent Test",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600
      };

      await registerJob("test_recent", jobDef, client);
      await updateJobStatus("test_recent", "SUCCESS");

      const job = await getJob("test_recent");
      expect(isJobOverdue(job)).toBe(false);
    });

    it("should handle never-run jobs", async () => {
      const jobDef = {
        displayName: "Never Run Test",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600
      };

      await registerJob("test_never_run", jobDef, client);

      const job = await getJob("test_never_run");
      expect(isJobOverdue(job)).toBe(false);
    });
  });

  describe("Job health status", () => {
    beforeAll(async () => {
      // Set up jobs with different health states
      const healthyJob = {
        displayName: "Healthy Job",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600
      };
      await registerJob("test_health_healthy", healthyJob, client);
      await updateJobStatus("test_health_healthy", "SUCCESS");

      const failedJob = {
        displayName: "Failed Job",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 3600
      };
      await registerJob("test_health_failed", failedJob, client);
      await updateJobStatus("test_health_failed", "FAILED");

      const overdueJob = {
        displayName: "Overdue Job",
        cronExpression: "0 * * * *",
        frequencyHours: 1,
        timeoutSeconds: 300,
        maxDelaySeconds: 300
      };
      await registerJob("test_health_overdue", overdueJob, client);
      await updateJobStatus("test_health_overdue", "SUCCESS");
      await client.query(
        `UPDATE job_registry SET last_completed_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
         WHERE job_name = $1`,
        ["test_health_overdue"]
      );
    });

    it("should get job health summary", async () => {
      const health = await getJobsHealth();

      expect(Array.isArray(health)).toBe(true);
      expect(health.length).toBeGreaterThan(0);
      expect(health[0]).toHaveProperty("health_status");
    });

    it("should prioritize failed jobs in health summary", async () => {
      const health = await getJobsHealth();

      const failedJob = health.find(j => j.job_name === "test_health_failed");
      expect(failedJob).toBeDefined();
      expect(failedJob.health_status).toBe("FAILED");
    });

    it("should identify overdue jobs", async () => {
      const health = await getJobsHealth();

      const overdueJob = health.find(j => j.job_name === "test_health_overdue");
      expect(overdueJob).toBeDefined();
      expect(overdueJob.health_status).toBe("OVERDUE");
    });

    it("should identify healthy jobs", async () => {
      const health = await getJobsHealth();

      const healthyJob = health.find(j => j.job_name === "test_health_healthy");
      expect(healthyJob).toBeDefined();
      expect(healthyJob.health_status).toBe("HEALTHY");
    });
  });

  describe("Job definitions", () => {
    it("should have predefined job definitions", () => {
      expect(Object.keys(JOB_DEFINITIONS).length).toBeGreaterThan(0);
    });

    it("should have all required properties in definitions", () => {
      for (const [name, def] of Object.entries(JOB_DEFINITIONS)) {
        expect(def.displayName).toBeDefined();
        expect(def.cronExpression).toBeDefined();
        expect(def.frequencyHours).toBeDefined();
        expect(def.timeoutSeconds).toBeDefined();
        expect(def.maxDelaySeconds).toBeDefined();
        expect(def.criticality).toBeDefined();
      }
    });

    it("should have valid cron expressions", () => {
      const cronRegex = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/;

      for (const [name, def] of Object.entries(JOB_DEFINITIONS)) {
        expect(cronRegex.test(def.cronExpression)).toBe(true);
      }
    });
  });
});
