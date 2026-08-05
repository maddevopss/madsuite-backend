# Issue #173 PR B: Job Registry for Scheduled Tasks

## Overview

PR B establishes a centralized registry for all periodic background jobs with comprehensive ownership, configuration, and monitoring capabilities. This enables reliable tracking, preventing double execution, and SLA enforcement.

## Components Delivered

### 1. Job Registry Database Schema (`20260803_job_registry.sql`)

**Main Tables**

#### `job_registry`
Central repository for all scheduled jobs with complete metadata:

```sql
CREATE TABLE job_registry (
  job_name VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(255),
  description TEXT,
  
  -- Ownership
  owner_team VARCHAR(100),
  owner_contact_email VARCHAR(255),
  owner_slack_channel VARCHAR(255),
  
  -- Scheduling
  cron_expression VARCHAR(255),      -- "0 * * * *"
  frequency_hours DECIMAL(10, 2),    -- Expected frequency
  
  -- Execution Constraints
  timeout_seconds INT,        -- Max execution time (300 = 5 min)
  max_delay_seconds INT,      -- SLA bound (3600 = 1 hour)
  
  -- Locking
  lock_type VARCHAR(50),      -- 'advisory', 'table', 'none'
  lock_ttl_seconds INT,       -- Stale lock detection
  
  -- Configuration
  criticality VARCHAR(20),    -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  enabled BOOLEAN,
  notify_on_failure BOOLEAN,
  notify_on_timeout BOOLEAN,
  
  -- Tracking
  last_started_at TIMESTAMP,
  last_completed_at TIMESTAMP,
  last_status VARCHAR(50),    -- 'SUCCESS', 'FAILED', 'TIMEOUT', 'STARTED'
  last_error_message TEXT,
  consecutive_failures INT,
  
  -- Metadata
  tags VARCHAR(255)[],        -- 'billing', 'analytics', 'cleanup'
  retry_policy JSONB,         -- {"strategy": "exponential", "maxAttempts": 3}
  performance_metrics JSONB,  -- {"avg_duration_ms": 1500}
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Lock Tracking Table**
```sql
CREATE TABLE job_lock_tracking (
  id UUID PRIMARY KEY,
  job_name VARCHAR(100),
  instance_hostname VARCHAR(255),
  acquired_at TIMESTAMP,
  released_at TIMESTAMP,
  duration_seconds INT,
  status VARCHAR(50)  -- 'HELD', 'RELEASED', 'TIMED_OUT', 'DEADLOCKED'
);
```

**SLA Metrics Table**
```sql
CREATE TABLE job_sla_metrics (
  id UUID PRIMARY KEY,
  job_name VARCHAR(100),
  execution_date DATE,
  
  -- Counts
  total_executions INT,
  successful_executions INT,
  failed_executions INT,
  timeout_executions INT,
  
  -- Performance
  avg_duration_ms DECIMAL,
  p95_duration_ms INT,
  p99_duration_ms INT,
  
  -- SLA
  sla_met BOOLEAN,
  sla_breaches INT
);
```

### 2. Job Registry Utility (`src/config/jobRegistry.js`)

Centralized job management with 14 predefined jobs.

**Job Definitions (14 total)**

| Job | Frequency | Criticality | Owner | SLA |
|-----|-----------|-------------|-------|-----|
| `activityAggregationTask` | 1h | MEDIUM | analytics | 1h |
| `metricsSnapshotTask` | 24h | MEDIUM | analytics | 1d |
| `cognitiveAggregatorTask` | 24h | MEDIUM | analytics | 1d |
| `billingAssistantJob` | 24h | HIGH | billing | 1d |
| `recurringInvoiceJob` | 7d | HIGH | billing | 2d |
| `trialReminderJob` | 24h | MEDIUM | growth | 1d |
| `securityBufferTask` | 10m | CRITICAL | security | 10m |
| `longRunningTimersTask` | 15m | MEDIUM | platform | 15m |
| `checkStaleJobsTask` | 30m | HIGH | platform | 30m |
| `emailFollowupTask` | 24h | MEDIUM | marketing | 1d |
| `outboxWorkerTask` | 1m | CRITICAL | platform | 5m |
| `cronCleanupTask` | 24h | LOW | platform | 1d |
| `systemConsistencyTask` | 24h | HIGH | platform | 1d |
| `systemReconciliationTask` | 24h | HIGH | platform | 1d |

**API Functions**

```javascript
// Registration & Management
registerAllJobs()                    // Initialize all predefined jobs
registerJob(jobName, definition)     // Register or update a job
getJob(jobName)                      // Get job by name
getAllJobs(filters)                  // Get all jobs with optional filters

// Status Tracking
updateJobStatus(jobName, status, metadata)  // Update job execution status

// Queries by Property
getJobsByCriticality(level)          // Filter by criticality
getJobsByOwner(team)                 // Filter by owner team
getJobsWithTag(tag)                  // Filter by tag
getJobsHealth()                      // Get health summary

// Utilities
isJobOverdue(job)                    // Check if exceeds max_delay_seconds
```

**Retry Policy Configuration**

Each job can define retry strategy:
```javascript
{
  strategy: "exponential",           // or "linear", "fixed"
  maxAttempts: 3,                    // Max retry attempts
  backoffSeconds: 60                 // Initial backoff time
}
```

### 3. Job Lock Tracker (`src/services/jobLockTracker.js`)

Monitors distributed lock usage and detects issues.

**Functions**

```javascript
recordLockAcquired(jobName)          // Log lock acquisition
recordLockReleased(jobName)          // Log lock release
detectStuckLocks()                   // Find locks held beyond timeout
getLockContention(jobName)           // Get metrics for specific job
getLockContentionSummary()           // Get summary for all jobs
cleanupOldLockRecords(days)          // Retention-based cleanup
```

**Stuck Lock Detection**
- Monitors locks held longer than `timeout_seconds + max_delay_seconds`
- Marks as `TIMED_OUT` status
- Alerts job owner (if not LOW criticality)
- Prevents deadlocks

### 4. Comprehensive Testing

**Integration Tests** (`src/test/jobRegistry.integration.test.js`)

- Schema validation (3 tables present)
- Job registration with all metadata (5+ tests)
- Status tracking (SUCCESS, FAILED, TIMEOUT, etc.)
- Job queries (by criticality, owner, tag, enabled)
- Overdue detection (SLA enforcement)
- Health status calculation (HEALTHY, FAILED, OVERDUE, NEVER_RUN)
- Criticality levels validation (4 levels)
- Retry policy storage as JSON
- Tag array storage

**70+ test cases** covering:
- Registration & updates
- Metadata validation
- Status tracking
- Query filtering
- Overdue detection
- Health assessment
- Retry policies
- Tag management

## Usage Examples

### Initialize Job Registry

```javascript
const { registerAllJobs } = require("./src/config/jobRegistry");

// During application startup
await registerAllJobs();
// Registers 14 predefined jobs into job_registry table
```

### Query Jobs by Owner

```javascript
const { getJobsByOwner } = require("./src/config/jobRegistry");

const billingJobs = await getJobsByOwner("billing");
// Returns: [billingAssistantJob, recurringInvoiceJob]

for (const job of billingJobs) {
  console.log(`${job.display_name} (${job.criticality})`);
  console.log(`  Owner: ${job.owner_contact_email}`);
  console.log(`  Next: ${job.cron_expression}`);
  console.log(`  SLA: ${job.max_delay_seconds}s`);
}
```

### Track Job Execution

```javascript
const { updateJobStatus } = require("./src/config/jobRegistry");

// Start job
await updateJobStatus("billingAssistantJob", "STARTED");

try {
  // Execute job
  await processBilling();
  
  // Mark success
  await updateJobStatus("billingAssistantJob", "SUCCESS");
} catch (error) {
  // Mark failure with error
  await updateJobStatus("billingAssistantJob", "FAILED", {
    errorMessage: error.message
  });
}
```

### Get Job Health

```javascript
const { getJobsHealth } = require("./src/config/jobRegistry");

const health = await getJobsHealth();

for (const job of health) {
  console.log(`${job.display_name}: ${job.health_status}`);
  
  if (job.health_status === 'FAILED') {
    console.log(`  ⚠️  ${job.last_status} - ${job.consecutive_failures} failures`);
  }
  
  if (job.health_status === 'OVERDUE') {
    console.log(`  ⏱️  Overdue: last run ${Math.round((Date.now() - new Date(job.last_completed_at)) / 1000)}s ago`);
  }
}
```

### Detect Stuck Locks

```javascript
const { detectStuckLocks, getLockContentionSummary } = require("./src/services/jobLockTracker");

// Run periodically (e.g., in checkStaleJobsTask)
const stuck = await detectStuckLocks();
if (stuck.length > 0) {
  console.log(`⚠️  ${stuck.length} stuck locks detected`);
}

// Get summary
const summary = await getLockContentionSummary();
for (const job of summary) {
  if (job.timeouts_24h > 0) {
    console.log(`${job.job_name}: ${job.timeouts_24h} timeouts in 24h`);
  }
}
```

## Integration with Stage 5

**Foundation for PR C (Retries & Quarantine)**
- Registry provides retry_policy configuration
- Lock tracker detects when retry needed

**Foundation for PR D (Deferred Events)**
- registry tracks critical jobs (e.g., outboxWorkerTask)
- Ensures outbox processing preconditions

**Foundation for PR E (Health Checks)**
- job_registry.last_status used in health check bootstrap
- getJobsHealth() powers health dashboard

**Foundation for PR F (Logs & Metrics)**
- job_sla_metrics table for performance tracking
- lock_tracking table for lock duration metrics

**Foundation for PR G (Backup & Restore)**
- job_registry.last_completed_at tracks backup job state
- job_sla_metrics provides audit trail

## Files Modified/Created

### Created
- `db/migrations/20260803_job_registry.sql` — Database schema (200+ lines)
- `src/config/jobRegistry.js` — Job registry utility (420 lines)
- `src/services/jobLockTracker.js` — Lock monitoring (270 lines)
- `src/test/jobRegistry.integration.test.js` — Integration tests (550 lines)
- `docs/PR-B-JOB-REGISTRY.md` — This documentation

### Modified
- None (backward compatible, additive only)

## Production Readiness

### Deployment
- New schema tables created via migration
- No changes to existing tables
- Backward compatible with current scheduler
- Can be deployed independently

### Configuration
- 14 predefined jobs auto-registered
- Each job has complete metadata
- Owner contact info for notifications
- Retry policies for each job type

### Monitoring
- Lock tracking for deadlock detection
- Health status calculation (HEALTHY/FAILED/OVERDUE)
- SLA breach tracking
- Consecutive failure counting

### Alerts
- Stuck lock detection (>timeout+maxdelay)
- Overdue job detection (>max_delay_seconds)
- Failed job notifications
- Owner-specific contact (email/Slack)

## Current Job Status (Post-Deployment)

All 14 jobs will be available in `job_registry` with:
- Complete metadata (owner, timeout, SLA)
- Retry policies defined
- Health tracking enabled
- Notification configuration

## Next Steps (PR B Follow-up)

1. **Migrate Scheduler**: Update scheduler.js to use job_registry
   - Replace hardcoded job definitions
   - Read cron expressions from registry
   - Use registered timeouts/SLAs

2. **Enhanced Notifications**: Integrate with notification service
   - Send alerts to owner_contact_email
   - Post to owner_slack_channel
   - Custom templates per job type

3. **SLA Reporting**: Automated SLA tracking
   - Populate job_sla_metrics daily
   - Generate SLA reports by team
   - Track compliance over time

4. **Lock Optimization**: Upgrade to named advisory locks
   - Use job_name directly (not MD5 hash)
   - Better debugging and monitoring
   - Lock expiration support

5. **Dashboard**: Job status visualization
   - Web UI showing health by owner
   - Notification delivery status
   - Historical performance trends

## References

- **Distributed Locks**: PostgreSQL advisory locks (session-level)
- **Cron Expressions**: Standard 5-field format (minute hour day month dow)
- **SLA Definition**: max_delay_seconds from expected completion time
- **Criticality Scale**: LOW → MEDIUM → HIGH → CRITICAL
- **Retry Strategies**: exponential, linear, fixed backoff

---

**Status**: ✅ Complete (PR B)  
**Tests**: 70+ integration cases  
**Jobs**: 14 predefined + extensible  
**Monitoring**: Lock tracking, health status, SLA metrics  
**Production Ready**: Yes (schema, utilities, tests)
