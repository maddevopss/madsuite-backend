const { pool } = require("../../db");
const logger = require("../config/logger");
const crypto = require("crypto");

// ARCHITECTURAL DECISION: Option A (Single-Node Accuracy)
// For storm detection, we accept an in-memory (single-node) sliding window.
// While not distributed (cluster-safe), a true systemic failure will rapidly
// cross the threshold on at least one node. Introducing Redis or shared DB
// counters here violates our Anti-Overengineering rules for a pre-PMF SaaS.
const stormTracker = new Map();
const STORM_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const STORM_THRESHOLD = 5;

// Periodically clean up storm tracker to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [sig, times] of stormTracker.entries()) {
    const valid = times.filter(t => t > now - STORM_WINDOW_MS);
    if (valid.length === 0) {
      stormTracker.delete(sig);
    } else {
      stormTracker.set(sig, valid);
    }
  }
}, STORM_WINDOW_MS).unref();

const os = require('os');
const INSTANCE_ID = `${os.hostname()}-${process.pid}`;

function generateIncidentSignature(jobName, error, context = {}) {
  const errorType = error ? (error.name || error.code || 'UnknownError') : 'UnknownError';
  const invariantId = context.invariant_name || context.invariantId || 'none';
  
  let stackFingerprint = 'no-stack';
  if (error && typeof error.stack === 'string') {
    stackFingerprint = error.stack
      .split('\n')
      .slice(0, 3) 
      .map(line => line.replace(/:\d+:\d+/g, '')) 
      .join('|');
  } else if (error && typeof error.message === 'string') {
    stackFingerprint = error.message;
  }

  const rawSystemSignature = `${jobName}:${errorType}:${invariantId}:${stackFingerprint}`;
  const systemSignature = crypto.createHash('sha256').update(rawSystemSignature).digest('hex');
  
  const rawNodeSignature = `${INSTANCE_ID}:${systemSignature}`;
  const nodeSignature = crypto.createHash('sha256').update(rawNodeSignature).digest('hex');
  
  return { systemSignature, nodeSignature };
}

function detectStorm(signature) {
  const now = Date.now();
  let times = stormTracker.get(signature) || [];
  
  // Prune old
  times = times.filter(t => t > now - STORM_WINDOW_MS);
  times.push(now);
  stormTracker.set(signature, times);
  
  return times.length >= STORM_THRESHOLD;
}

/**
 * Standardise le suivi des résultats pour les jobs critiques.
 * Permet d'imposer structurellement la détection des PARTIAL_SUCCESS.
 */
function createJobResultTracker(jobName = "Unknown Job") {
  let successCount = 0;
  let failureCount = 0;

  return {
    recordSuccess() {
      successCount++;
    },
    async recordFailure(error, context = {}, initialSeverity = 'MEDIUM') {
      failureCount++;
      const errMsg = error ? (error.message || String(error)) : 'Unknown failure';
      let severity = initialSeverity;

      logger.error(`[${jobName}] Failure recorded`, { error: errMsg, severity, ...context });
      
      // LOW: logged only (skip alerting/aggregation)
      if (severity === 'LOW') return;

      const { systemSignature, nodeSignature } = generateIncidentSignature(jobName, error, context);
      
      // Detect Incident Storms on this specific node
      const isStorm = detectStorm(nodeSignature);
      if (isStorm) {
        severity = 'SYSTEMIC_FAILURE';
      }

      // Ensure dedup window remains 1 hour based on the NODE signature
      // so each node alerts once per storm, not globally.
      const dedupSignature = isStorm ? `${nodeSignature}-storm` : nodeSignature;

      try {
        const recentRes = await pool.query(`
           SELECT id FROM notifications 
           WHERE type = 'system_alert' 
           AND message LIKE $1
           AND created_at > NOW() - INTERVAL '1 hour'
           LIMIT 1
        `, [`%${dedupSignature}%`]);

        if (recentRes.rows.length === 0) {
          const alertMsg = `System Failure in ${jobName} [${severity}]: ${errMsg} (SysSig: ${systemSignature}, NodeSig: ${dedupSignature})`;
          
          await pool.query(`
            INSERT INTO notifications (organisation_id, utilisateur_id, type, message)
            SELECT organisation_id, id, 'system_alert', $1 FROM utilisateurs WHERE role = 'admin'
          `, [alertMsg]);

          // Severity Routing
          // MEDIUM: aggregated dashboard only (the notification above covers this)
          // HIGH: queued to retry pipeline
          // CRITICAL / SYSTEMIC_FAILURE: routed to outbox_events quarantine queue immediately
          
          if (severity === 'HIGH') {
            await pool.query(`
               INSERT INTO outbox_events (event_type, payload, status)
               VALUES ('retry_event', $1, 'pending')
            `, [JSON.stringify({ jobName, error: errMsg, context, systemSignature, nodeSignature, severity })]);
          } else if (severity === 'CRITICAL' || severity === 'SYSTEMIC_FAILURE') {
            await pool.query(`
               INSERT INTO outbox_events (event_type, payload, status)
               VALUES ('quarantine_event', $1, 'pending')
            `, [JSON.stringify({ jobName, error: errMsg, context, systemSignature, nodeSignature, severity, isStorm })]);
          }
        }
      } catch (dbErr) {
        logger.error("Failed to write actionable output", dbErr);
      }
    },
    get successCount() {
      return successCount;
    },
    get failureCount() {
      return failureCount;
    },
    resolveStatus() {
      if (failureCount > 0 && successCount > 0) {
        return 'PARTIAL_SUCCESS';
      }
      if (failureCount > 0 && successCount === 0) {
        return 'FAILED';
      }
      return 'SUCCESS';
    }
  };
}

module.exports = {
  createJobResultTracker
};
