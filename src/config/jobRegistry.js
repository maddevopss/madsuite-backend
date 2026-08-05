/**
 * Job Registry
 *
 * Centralized definition of all scheduled jobs with metadata:
 * - Owner and contact information
 * - Execution constraints (timeout, max delay)
 * - Lock configuration
 * - Criticality and monitoring
 * - Performance expectations
 */

const db = require("../../db");
const logger = require("./logger");

/**
 * Centralized job definitions
 * Each job defines its schedule, constraints, and ownership
 */
const JOB_DEFINITIONS = {
  // ===== Analytics & Activity =====
  activityAggregationTask: {
    displayName: "Activity Aggregation",
    description: "Aggregates activity logs into daily summaries for performance",
    ownerTeam: "analytics",
    ownerContactEmail: "analytics@maddevops.com",
    ownerSlackChannel: "#analytics-team",
    cronExpression: "5 * * * *",  // 05 minute of every hour
    frequencyHours: 1,
    timeoutSeconds: 300,
    maxDelaySeconds: 3600,
    criticality: "MEDIUM",
    tags: ["analytics", "performance"],
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 3,
      backoffSeconds: 60
    }
  },

  metricsSnapshotTask: {
    displayName: "Metrics Snapshot",
    description: "Takes daily snapshot of system metrics",
    ownerTeam: "analytics",
    ownerContactEmail: "analytics@maddevops.com",
    ownerSlackChannel: "#analytics-team",
    cronExpression: "0 0 * * *",  // Daily at midnight
    frequencyHours: 24,
    timeoutSeconds: 600,
    maxDelaySeconds: 86400,  // Within 1 day
    criticality: "MEDIUM",
    tags: ["analytics", "metrics"],
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 2,
      backoffSeconds: 300
    }
  },

  cognitiveAggregatorTask: {
    displayName: "Cognitive Metrics Aggregation",
    description: "Aggregates cognitive assistance metrics and trends",
    ownerTeam: "analytics",
    ownerContactEmail: "analytics@maddevops.com",
    ownerSlackChannel: "#analytics-team",
    cronExpression: "0 2 * * *",  // Daily at 2 AM
    frequencyHours: 24,
    timeoutSeconds: 900,
    maxDelaySeconds: 86400,
    criticality: "MEDIUM",
    tags: ["analytics", "cognitive"],
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 2,
      backoffSeconds: 300
    }
  },

  // ===== Billing & Invoices =====
  billingAssistantJob: {
    displayName: "Billing Assistant",
    description: "Processes billing reminders and prepares invoices",
    ownerTeam: "billing",
    ownerContactEmail: "billing@maddevops.com",
    ownerSlackChannel: "#billing-team",
    cronExpression: "0 8 * * *",  // Daily at 8 AM
    frequencyHours: 24,
    timeoutSeconds: 1200,
    maxDelaySeconds: 86400,
    criticality: "HIGH",
    tags: ["billing", "invoices"],
    notifyOnFailure: true,
    notifyOnTimeout: true,
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 3,
      backoffSeconds: 300
    }
  },

  recurringInvoiceJob: {
    displayName: "Recurring Invoices",
    description: "Generates and processes recurring invoices",
    ownerTeam: "billing",
    ownerContactEmail: "billing@maddevops.com",
    ownerSlackChannel: "#billing-team",
    cronExpression: "0 0 * * 0",  // Weekly on Sunday at midnight
    frequencyHours: 168,  // 7 days
    timeoutSeconds: 1800,
    maxDelaySeconds: 172800,  // Within 2 days
    criticality: "HIGH",
    tags: ["billing", "invoices"],
    notifyOnFailure: true,
    notifyOnTimeout: true,
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 2,
      backoffSeconds: 600
    }
  },

  // ===== Trial & Subscriptions =====
  trialReminderJob: {
    displayName: "Trial Reminders",
    description: "Sends trial expiration reminders to users",
    ownerTeam: "growth",
    ownerContactEmail: "growth@maddevops.com",
    ownerSlackChannel: "#growth-team",
    cronExpression: "0 10 * * *",  // Daily at 10 AM
    frequencyHours: 24,
    timeoutSeconds: 600,
    maxDelaySeconds: 86400,
    criticality: "MEDIUM",
    tags: ["subscriptions", "marketing"],
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 2,
      backoffSeconds: 300
    }
  },

  // ===== Security & System =====
  securityBufferTask: {
    displayName: "Security Buffer",
    description: "Processes security incidents and alerts",
    ownerTeam: "security",
    ownerContactEmail: "security@maddevops.com",
    ownerSlackChannel: "#security-team",
    cronExpression: "*/10 * * * *",  // Every 10 minutes
    frequencyHours: 1,
    timeoutSeconds: 180,
    maxDelaySeconds: 600,  // Strict SLA: 10 minutes
    criticality: "CRITICAL",
    tags: ["security", "incidents"],
    notifyOnFailure: true,
    notifyOnTimeout: true,
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 1,
      backoffSeconds: 30
    }
  },

  longRunningTimersTask: {
    displayName: "Long Running Timers",
    description: "Monitors and alerts on long-running operations",
    ownerTeam: "platform",
    ownerContactEmail: "platform@maddevops.com",
    ownerSlackChannel: "#platform-team",
    cronExpression: "*/15 * * * *",  // Every 15 minutes
    frequencyHours: 1,
    timeoutSeconds: 300,
    maxDelaySeconds: 900,
    criticality: "MEDIUM",
    tags: ["monitoring", "system"],
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 1,
      backoffSeconds: 60
    }
  },

  checkStaleJobsTask: {
    displayName: "Stale Jobs Check",
    description: "Monitors for stale or missing job executions",
    ownerTeam: "platform",
    ownerContactEmail: "platform@maddevops.com",
    ownerSlackChannel: "#platform-team",
    cronExpression: "*/30 * * * *",  // Every 30 minutes
    frequencyHours: 1,
    timeoutSeconds: 300,
    maxDelaySeconds: 1800,
    criticality: "HIGH",
    tags: ["monitoring", "jobs"],
    notifyOnFailure: true,
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 1,
      backoffSeconds: 60
    }
  },

  // ===== Email & Communication =====
  emailFollowupTask: {
    displayName: "Email Followup",
    description: "Sends scheduled email follow-ups to users",
    ownerTeam: "marketing",
    ownerContactEmail: "marketing@maddevops.com",
    ownerSlackChannel: "#marketing-team",
    cronExpression: "0 9 * * *",  // Daily at 9 AM
    frequencyHours: 24,
    timeoutSeconds: 600,
    maxDelaySeconds: 86400,
    criticality: "MEDIUM",
    tags: ["email", "marketing"],
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 2,
      backoffSeconds: 300
    }
  },

  // ===== Event Processing =====
  outboxWorkerTask: {
    displayName: "Outbox Worker",
    description: "Processes pending outbox events for delivery",
    ownerTeam: "platform",
    ownerContactEmail: "platform@maddevops.com",
    ownerSlackChannel: "#platform-team",
    cronExpression: "* * * * *",  // Every minute
    frequencyHours: 1,
    timeoutSeconds: 60,
    maxDelaySeconds: 300,  // Must complete within 5 minutes
    criticality: "CRITICAL",
    tags: ["events", "outbox"],
    notifyOnFailure: true,
    notifyOnTimeout: true,
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 3,
      backoffSeconds: 10
    }
  },

  // ===== Maintenance =====
  cronCleanupTask: {
    displayName: "Cron Logs Cleanup",
    description: "Cleans up old cron execution logs based on retention policy",
    ownerTeam: "platform",
    ownerContactEmail: "platform@maddevops.com",
    ownerSlackChannel: "#platform-team",
    cronExpression: "0 3 * * *",  // Daily at 3 AM
    frequencyHours: 24,
    timeoutSeconds: 1800,
    maxDelaySeconds: 86400,
    criticality: "LOW",
    tags: ["maintenance", "cleanup"],
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 2,
      backoffSeconds: 600
    }
  },

  // ===== System Integrity =====
  systemConsistencyTask: {
    displayName: "System Consistency Check",
    description: "Verifies system data consistency and integrity",
    ownerTeam: "platform",
    ownerContactEmail: "platform@maddevops.com",
    ownerSlackChannel: "#platform-team",
    cronExpression: "0 4 * * *",  // Daily at 4 AM
    frequencyHours: 24,
    timeoutSeconds: 2400,
    maxDelaySeconds: 86400,
    criticality: "HIGH",
    tags: ["system", "integrity"],
    notifyOnFailure: true,
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 1,
      backoffSeconds: 600
    }
  },

  systemReconciliationTask: {
    displayName: "System Reconciliation",
    description: "Reconciles system state across data sources",
    ownerTeam: "platform",
    ownerContactEmail: "platform@maddevops.com",
    ownerSlackChannel: "#platform-team",
    cronExpression: "0 5 * * *",  // Daily at 5 AM
    frequencyHours: 24,
    timeoutSeconds: 2400,
    maxDelaySeconds: 86400,
    criticality: "HIGH",
    tags: ["system", "reconciliation"],
    notifyOnFailure: true,
    retryPolicy: {
      strategy: "exponential",
      maxAttempts: 1,
      backoffSeconds: 600
    }
  }
};

/**
 * Register all jobs in the database
 * Called during application startup
 */
async function registerAllJobs() {
  const client = await db.pool.connect();

  try {
    for (const [jobName, definition] of Object.entries(JOB_DEFINITIONS)) {
      await registerJob(jobName, definition, client);
    }
    logger.info(`Registered ${Object.keys(JOB_DEFINITIONS).length} jobs in registry`);
  } catch (error) {
    logger.error("Error registering jobs:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Register a single job
 */
async function registerJob(jobName, definition, client = null) {
  const shouldRelease = !client;
  if (!client) {
    client = await db.pool.connect();
  }

  try {
    const query = `
      INSERT INTO job_registry (
        job_name, display_name, description,
        owner_team, owner_contact_email, owner_slack_channel,
        cron_expression, frequency_hours,
        timeout_seconds, max_delay_seconds,
        criticality, tags, retry_policy,
        notify_on_failure, notify_on_timeout, enabled
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true)
      ON CONFLICT (job_name) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        owner_team = EXCLUDED.owner_team,
        owner_contact_email = EXCLUDED.owner_contact_email,
        owner_slack_channel = EXCLUDED.owner_slack_channel,
        cron_expression = EXCLUDED.cron_expression,
        frequency_hours = EXCLUDED.frequency_hours,
        timeout_seconds = EXCLUDED.timeout_seconds,
        max_delay_seconds = EXCLUDED.max_delay_seconds,
        criticality = EXCLUDED.criticality,
        tags = EXCLUDED.tags,
        retry_policy = EXCLUDED.retry_policy,
        notify_on_failure = EXCLUDED.notify_on_failure,
        notify_on_timeout = EXCLUDED.notify_on_timeout
    `;

    await client.query(query, [
      jobName,
      definition.displayName,
      definition.description || null,
      definition.ownerTeam || null,
      definition.ownerContactEmail || null,
      definition.ownerSlackChannel || null,
      definition.cronExpression,
      definition.frequencyHours,
      definition.timeoutSeconds || 300,
      definition.maxDelaySeconds || 3600,
      definition.criticality || "MEDIUM",
      definition.tags || [],
      definition.retryPolicy ? JSON.stringify(definition.retryPolicy) : null,
      definition.notifyOnFailure !== false,
      definition.notifyOnTimeout !== false
    ]);
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

/**
 * Get all registered jobs
 */
async function getAllJobs(filters = {}) {
  const query = `
    SELECT
      job_name, display_name, description,
      owner_team, owner_contact_email, owner_slack_channel,
      cron_expression, frequency_hours,
      timeout_seconds, max_delay_seconds,
      criticality, enabled,
      last_started_at, last_completed_at, last_status,
      consecutive_failures, tags,
      created_at, updated_at
    FROM job_registry
    WHERE 1=1
      ${filters.enabled !== undefined ? `AND enabled = $${Object.keys(filters).indexOf('enabled') + 1}` : ''}
      ${filters.criticality ? `AND criticality = $${Object.keys(filters).indexOf('criticality') + 1}` : ''}
      ${filters.ownerTeam ? `AND owner_team = $${Object.keys(filters).indexOf('ownerTeam') + 1}` : ''}
      ${filters.tag ? `AND $${Object.keys(filters).indexOf('tag') + 1} = ANY(tags)` : ''}
    ORDER BY job_name
  `;

  const values = Object.values(filters);
  const result = await db.pool.query(query, values.length > 0 ? values : undefined);
  return result.rows;
}

/**
 * Get a specific job
 */
async function getJob(jobName) {
  const result = await db.pool.query(
    `SELECT * FROM job_registry WHERE job_name = $1`,
    [jobName]
  );
  return result.rows[0] || null;
}

/**
 * Update job execution status
 */
async function updateJobStatus(jobName, status, metadata = {}) {
  const query = `
    UPDATE job_registry
    SET
      last_started_at = CASE WHEN $2 = 'STARTED' THEN CURRENT_TIMESTAMP ELSE last_started_at END,
      last_completed_at = CASE WHEN $2 IN ('SUCCESS', 'FAILED', 'TIMEOUT') THEN CURRENT_TIMESTAMP ELSE last_completed_at END,
      last_status = $2,
      last_error_message = $3,
      consecutive_failures = CASE
        WHEN $2 = 'SUCCESS' THEN 0
        WHEN $2 = 'FAILED' THEN consecutive_failures + 1
        ELSE consecutive_failures
      END
    WHERE job_name = $1
    RETURNING *
  `;

  const result = await db.pool.query(query, [
    jobName,
    status,
    metadata.errorMessage || null
  ]);

  return result.rows[0] || null;
}

/**
 * Check if job is overdue
 */
function isJobOverdue(job) {
  if (!job.last_completed_at) return false;

  const lastCompleted = new Date(job.last_completed_at);
  const maxDelayMs = job.max_delay_seconds * 1000;
  const now = new Date();

  return (now.getTime() - lastCompleted.getTime()) > maxDelayMs;
}

/**
 * Get jobs by criticality
 */
async function getJobsByCriticality(criticality) {
  return getAllJobs({ criticality });
}

/**
 * Get jobs by owner team
 */
async function getJobsByOwner(ownerTeam) {
  return getAllJobs({ ownerTeam });
}

/**
 * Get jobs with tag
 */
async function getJobsWithTag(tag) {
  return getAllJobs({ tag });
}

/**
 * Get health summary of all jobs
 */
async function getJobsHealth() {
  const result = await db.pool.query(`
    SELECT
      job_name,
      display_name,
      criticality,
      owner_team,
      enabled,
      last_status,
      last_completed_at,
      consecutive_failures,
      max_delay_seconds,
      CASE
        WHEN last_completed_at IS NULL THEN 'NEVER_RUN'
        WHEN (CURRENT_TIMESTAMP - last_completed_at) > (max_delay_seconds || ' seconds')::INTERVAL THEN 'OVERDUE'
        WHEN last_status = 'FAILED' THEN 'FAILED'
        WHEN last_status = 'SUCCESS' THEN 'HEALTHY'
        ELSE 'UNKNOWN'
      END as health_status
    FROM job_registry
    WHERE enabled = true
    ORDER BY
      CASE
        WHEN last_status = 'FAILED' THEN 0
        WHEN (CURRENT_TIMESTAMP - last_completed_at) > (max_delay_seconds || ' seconds')::INTERVAL THEN 1
        ELSE 2
      END,
      criticality DESC,
      job_name
  `);

  return result.rows;
}

module.exports = {
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
};
