/**
 * Cron Registry
 * Centralizes the expected frequency (in hours) and criticality of each scheduled job.
 * Used by the cronMonitor to detect stale jobs dynamically.
 */
module.exports = {
  // Billing & Invoices
  billingAssistantJob: { frequencyHours: 24, criticality: 'HIGH' },
  recurringInvoiceJob: { frequencyHours: 24, criticality: 'HIGH' },
  
  // Trial & Subscriptions
  trialReminderJob: { frequencyHours: 24, criticality: 'MEDIUM' },
  
  // Analytics & Activity
  activityAggregationTask: { frequencyHours: 1, criticality: 'MEDIUM' },
  metricsAggregationJob: { frequencyHours: 24, criticality: 'MEDIUM' },
  cognitiveAggregatorTask: { frequencyHours: 24, criticality: 'MEDIUM' },
  
  // System & Security
  securityBufferTask: { frequencyHours: 1, criticality: 'HIGH' }, // runs every 10 min, so 1h max expected
  longRunningTimersTask: { frequencyHours: 1, criticality: 'LOW' }, // runs every 15 min, 1h max expected
  
  // Email & Communication
  emailFollowupTask: { frequencyHours: 24, criticality: 'MEDIUM' },
  
  // Outbox
  outboxWorkerTask: { frequencyHours: 1, criticality: 'HIGH' }, // runs every minute, 1h max expected
  
  // Cleanup
  cronCleanupTask: { frequencyHours: 24, criticality: 'LOW' },

  // System
  systemConsistencyTask: { frequencyHours: 24, criticality: 'HIGH' }
};
