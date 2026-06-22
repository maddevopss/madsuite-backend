const cron = require("node-cron");

const logger = require("../config/logger");
const { pool } = require("../../db");
const { aggregateActivityLogs } = require("./aggregateActivityLogs");
const { checkLongRunningTimers } = require("./checkLongRunningTimers");
const { processReminders } = require("./billingAssistantJob");
const { processSecurityBuffer } = require("./securityBufferJob");
const EmailFollowupService = require("../services/email-followup.service");
const { processRecurringInvoices } = require("./recurringInvoiceJob");
const { processOutboxEvents } = require("./outboxWorker");
const { generateMetricsSnapshots } = require("./metricsSnapshotJob");
const { runSystemConsistencyCheck } = require("./systemConsistencyJob");
const { runSystemReconciliation } = require("./systemReconciliationJob");
const cronMonitor = require("../services/cronMonitor.service");
const distributedLock = require("../services/distributedLock.service");
const cronRegistry = require("../config/cron_registry");
const { runWithContext } = require("../core/executionContext");

function startSchedulers() {
  const activeJobs = [
    "activityAggregationTask",
    "longRunningTimersTask",
    "billingAssistantJob",
    "securityBufferTask",
    "cognitiveAggregatorTask",
    "emailFollowupTask",
    "recurringInvoiceJob",
    "outboxWorkerTask",
    "checkStaleJobsTask",
    "cronCleanupTask",
    "metricsSnapshotTask",
    "systemConsistencyTask",
    "systemReconciliationTask"
  ];

  const registryJobs = Object.keys(cronRegistry);
  const missingInRegistry = activeJobs.filter(job => !registryJobs.includes(job));
  const missingInScheduler = registryJobs.filter(job => !activeJobs.includes(job));

  if (missingInRegistry.length > 0 || missingInScheduler.length > 0) {
    const message = `WARNING_CRON_REGISTRY_MISMATCH: missing_in_registry=[${missingInRegistry.join(', ')}], missing_in_scheduler=[${missingInScheduler.join(', ')}]`;
    logger.warn(message);

    pool.query(`
      INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
      SELECT organisation_id, id, 'system_alert', $1 
      FROM utilisateurs 
      WHERE role = 'admin'
    `, [message]).catch(err => logger.error("Erreur notification admin (cron registry mismatch):", err));
  }

  // Agrégation toutes les heures pour garder activity_logs léger
  const activityAggregationTask = cron.schedule("5 * * * *", async () => {
    const jobName = "activityAggregationTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    logger.info("Lancement de l'agrégation incrémentale...");
    try {
      await aggregateActivityLogs();
      logger.info("Aggregation activity_logs terminee");
      await cronMonitor.recordJobSuccess(logId);
    } catch (error) {
      logger.error("Erreur scheduler activity_logs", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  const longRunningTimersTask = cron.schedule("*/15 * * * *", async () => {
    const jobName = "longRunningTimersTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      await checkLongRunningTimers();
      await cronMonitor.recordJobSuccess(logId);
    } catch (error) {
      logger.error("Erreur scheduler timers long-running", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  const billingAssistantTask = cron.schedule("0 8 * * *", async () => {
    const jobName = "billingAssistantJob";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      const result = await runWithContext({ strict_mode_snapshot: process.env.STRICT_INVARIANTS_MODE || 'observe_only' }, async () => {
        return await processReminders();
      });
      if (result && result.status === 'PARTIAL_SUCCESS') {
        await cronMonitor.recordJobPartialSuccess(logId, result);
      } else if (result && result.status === 'FAILED') {
        await cronMonitor.recordJobFailure(logId, "All items failed");
      } else {
        await cronMonitor.recordJobSuccess(logId);
      }
    } catch (error) {
      logger.error("Erreur scheduler billing assistant", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  // Tâche de sécurité: vérifier le buffer d'incidents toutes les 10 minutes
  const securityBufferTask = cron.schedule("*/10 * * * *", async () => {
    const jobName = "securityBufferTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      await processSecurityBuffer();
      await cronMonitor.recordJobSuccess(logId);
    } catch (error) {
      logger.error("Erreur scheduler security buffer", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  // Agrégation historique cognitive quotidienne à 2h00 du matin
  const cognitiveAggregatorTask = cron.schedule("0 2 * * *", async () => {
    const jobName = "cognitiveAggregatorTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      const { aggregateCognitiveMetrics } = require("./cognitiveAggregator");
      await aggregateCognitiveMetrics();
      await cronMonitor.recordJobSuccess(logId);
    } catch (error) {
      logger.error("Erreur scheduler cognitive aggregator", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  // Phase 2: Email follow-ups (Daily at 9h00 AM)
  const emailFollowupTask = cron.schedule("0 9 * * *", async () => {
    const jobName = "emailFollowupTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      await EmailFollowupService.runDailyFollowups();
      await cronMonitor.recordJobSuccess(logId);
    } catch (error) {
      logger.error("Erreur scheduler email follow-up", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  // Phase 3: Recurring Invoices (Daily at 6h00 AM)
  const recurringInvoiceTask = cron.schedule("0 6 * * *", async () => {
    const jobName = "recurringInvoiceJob";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      const result = await processRecurringInvoices();
      if (result && result.status === 'PARTIAL_SUCCESS') {
        await cronMonitor.recordJobPartialSuccess(logId, result);
      } else if (result && result.status === 'FAILED') {
        await cronMonitor.recordJobFailure(logId, "All items failed");
      } else {
        await cronMonitor.recordJobSuccess(logId);
      }
    } catch (error) {
      logger.error("Erreur scheduler recurring invoices", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  // Outbox Worker (Every minute)
  const outboxWorkerTask = cron.schedule("* * * * *", async () => {
    const jobName = "outboxWorkerTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      const result = await processOutboxEvents();
      if (result && result.status === 'PARTIAL_SUCCESS') {
        await cronMonitor.recordJobPartialSuccess(logId, result);
      } else if (result && result.status === 'FAILED') {
        await cronMonitor.recordJobFailure(logId, "All items failed");
      } else {
        await cronMonitor.recordJobSuccess(logId);
      }
    } catch (error) {
      logger.error("Erreur scheduler outbox worker", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  // Health check: Verify stale critical jobs every hour
  const checkStaleJobsTask = cron.schedule("0 * * * *", async () => {
    const jobName = "checkStaleJobsTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    try {
      await cronMonitor.checkStaleJobs();
    } catch (error) {
      logger.error("Erreur scheduler checkStaleJobs", { error });
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  // Cleanup old execution logs (Daily at 3:00 AM)
  const cronCleanupTask = cron.schedule("0 3 * * *", async () => {
    const jobName = "cronCleanupTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      await cronMonitor.cleanupOldLogs();
      await cronMonitor.recordJobSuccess(logId);
    } catch (error) {
      logger.error("Erreur scheduler cleanupOldLogs", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  // Metrics Snapshot (Daily at 1:00 AM)
  const metricsSnapshotTask = cron.schedule("0 1 * * *", async () => {
    const jobName = "metricsSnapshotTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      await generateMetricsSnapshots();
      await cronMonitor.recordJobSuccess(logId);
    } catch (error) {
      logger.error("Erreur scheduler metrics snapshot", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  // System Consistency (Daily at 4:00 AM)
  const systemConsistencyTask = cron.schedule("0 4 * * *", async () => {
    const jobName = "systemConsistencyTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      await runSystemConsistencyCheck();
      await cronMonitor.recordJobSuccess(logId);
    } catch (error) {
      logger.error("Erreur scheduler system consistency", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  // Global System Reconciliation (Daily at 5:00 AM)
  const systemReconciliationTask = cron.schedule("0 5 * * *", async () => {
    const jobName = "systemReconciliationTask";
    if (!(await distributedLock.acquireLock(jobName))) return;
    
    const logId = await cronMonitor.recordJobStart(jobName);
    try {
      const result = await runWithContext({ strict_mode_snapshot: process.env.STRICT_INVARIANTS_MODE || 'observe_only' }, async () => {
        return await runSystemReconciliation();
      });
      if (result && result.status === 'PARTIAL_SUCCESS') {
        await cronMonitor.recordJobPartialSuccess(logId, result);
      } else if (result && result.status === 'FAILED') {
        await cronMonitor.recordJobFailure(logId, "Reconciliation failed with anomalies");
      } else {
        await cronMonitor.recordJobSuccess(logId);
      }
    } catch (error) {
      logger.error("Erreur scheduler system reconciliation", { error });
      await cronMonitor.recordJobFailure(logId, error.message);
    } finally {
      await distributedLock.releaseLock(jobName);
    }
  });

  logger.info("Schedulers demarres");

  return [activityAggregationTask, longRunningTimersTask, billingAssistantTask, securityBufferTask, cognitiveAggregatorTask, emailFollowupTask, recurringInvoiceTask, outboxWorkerTask, checkStaleJobsTask, cronCleanupTask, metricsSnapshotTask, systemConsistencyTask, systemReconciliationTask];
}

module.exports = { startSchedulers };
