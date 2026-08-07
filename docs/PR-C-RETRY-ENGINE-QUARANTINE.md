# Issue #173 PR C: Retry Engine & Quarantine System

## Overview

PR C implements a generalized retry and quarantine system for handling transient and permanent failures across all async operations. Supports multiple backoff strategies, automatic error classification, and manual recovery with full audit trails.

## Components Delivered

### 1. Retry Engine Database Schema (`20260802_99_retry_engine_quarantine.sql` + `20260803_00_retry_engine_quarantine.sql`)

**Main Tables**

#### `retry_attempts`
Track all retry attempts across any work type with full context:

```sql
CREATE TABLE retry_attempts (
  id UUID PRIMARY KEY,
  work_type VARCHAR(100),      -- 'email', 'webhook', 'payment', etc
  work_id VARCHAR(255),         -- ID in original system
  attempt_number INT,
  attempt_at TIMESTAMP,
  status VARCHAR(50),           -- 'pending', 'success', 'failed_transient', 'failed_permanent'
  error_classification VARCHAR(50),  -- 'network', 'validation', 'rate_limit', 'unknown'
  error_message TEXT,
  error_code VARCHAR(50),
  backoff_strategy VARCHAR(50), -- 'exponential', 'linear', 'fixed'
  backoff_multiplier DECIMAL(5, 2),
  backoff_seconds INT,          -- Calculated wait before this attempt
  metadata JSONB,               -- Arbitrary debugging context
  created_at TIMESTAMP
);
```

#### `quarantine_queue`
Dead letter queue for permanently failed items with recovery support:

```sql
CREATE TABLE quarantine_queue (
  id UUID PRIMARY KEY,
  work_type VARCHAR(100),
  work_id VARCHAR(255),
  reason VARCHAR(255),  -- 'max_retries_exceeded', 'permanent_error'
  permanent_error_code VARCHAR(50),
  permanent_error_message TEXT,
  total_attempts INT,
  first_attempt_at TIMESTAMP,
  last_attempt_at TIMESTAMP,
  payload JSONB,        -- Full original work data
  tags VARCHAR(255)[],  -- For categorization
  recovery_attempts INT DEFAULT 0,
  recovery_status VARCHAR(50),  -- 'waiting', 'in_progress', 'recovered'
  notes TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

#### `recovery_operations`
Audit trail for manual recovery attempts:

```sql
CREATE TABLE recovery_operations (
  id UUID PRIMARY KEY,
  quarantine_id UUID NOT NULL REFERENCES quarantine_queue(id),
  work_type VARCHAR(100),
  work_id VARCHAR(255),
  operation_type VARCHAR(50),   -- 'manual_retry', 'fix_and_retry', 'delete', 'skip'
  initiated_by VARCHAR(255),    -- User email or system ID
  initiated_at TIMESTAMP,
  payload_override JSONB,       -- Optional: modified payload for retry
  status VARCHAR(50),           -- 'pending', 'succeeded', 'failed'
  result_message TEXT,
  completed_at TIMESTAMP
);
```

#### `retry_policies`
Reusable retry configurations (integrates with job_registry):

```sql
CREATE TABLE retry_policies (
  id UUID PRIMARY KEY,
  policy_name VARCHAR(100) UNIQUE,
  description TEXT,
  backoff_strategy VARCHAR(50),
  initial_backoff_seconds INT,
  backoff_multiplier DECIMAL(5, 2),
  max_backoff_seconds INT,
  max_attempts INT DEFAULT 3,
  max_total_duration_seconds INT,
  retryable_error_codes VARCHAR(50)[],    -- Codes to retry on
  permanent_error_codes VARCHAR(50)[],    -- Codes that skip retries
  quarantine_on_permanent_error BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Predefined Retry Policies (6 total)**

| Policy | Strategy | Initial | Attempts | Total Duration | Use Case |
|--------|----------|---------|----------|-----------------|----------|
| `aggressive` | exponential | 10s | 5 | 900s | Critical operations |
| `moderate` | exponential | 60s | 4 | 3600s | Balanced default |
| `conservative` | linear | 300s | 3 | 7200s | Stable systems |
| `email_delivery` | exponential | 60s | 6 | 14400s | Email/SMTP |
| `webhook` | exponential | 30s | 5 | 1800s | Webhook delivery |
| `api_call` | exponential | 60s | 4 | 3600s | API integrations |

### 2. Retry Engine Service (`src/services/retryEngine.js`)

**Core API**

```javascript
// Backoff calculation
calculateBackoffDelay(strategy, initialBackoff, multiplier, attemptNumber)
// Returns: milliseconds to wait
// Strategies: 'exponential', 'linear', 'fixed'
// Exponential capped at 10x multiplier to prevent runaway

// Attempt recording
recordRetryAttempt(workType, workId, config)
// config: {attemptNumber, status, errorCode, errorMessage, errorClassification,
//          backoffStrategy, backoffMultiplier, metadata}
// Returns: {id, attempt_at, backoff_seconds}

// Error classification
classifyError(error, errorCode, retryPolicy)
// Returns: {classification: 'transient'|'permanent', errorClassification: type}
// Network errors (50x, 429, 408, ECONNREFUSED) → transient
// Validation errors (401, 403, 404, 422) → permanent
// Against policy.permanent_error_codes if provided

// Decision logic
handleRetryOrQuarantine(workType, workId, config)
// config: {attemptNumber, maxAttempts, error, errorCode, errorMessage,
//          payload, retryPolicy, metadata}
// Returns: {action, reason, message, nextAttempt}
// Action: 'retry' or 'quarantine'
```

**Quarantine Management**

```javascript
// Quarantine work item
quarantineWork(workType, workId, config)
// config: {reason, errorCode, errorMessage, payload, tags, ...}
// Returns: quarantine record

// Retrieve quarantine items
getQuarantineItem(workType, workId)
getQuarantineQueue(workType, filters)  // filters: {reason, recoveryStatus, tag, limit}

// Manual recovery
initiateRecovery(quarantineId, config)
// config: {operationType, initiatedBy, payloadOverride}
// Returns: recovery_operations record

markRecoverySucceeded(recoveryId, message)
markRecoveryFailed(recoveryId, errorMessage)
```

**Policy & Statistics**

```javascript
// Policy management
getRetryPolicy(policyName)
getAllRetryPolicies()

// Statistics
getRetryStats(workType)     // 24h window: count by status/classification
getQuarantineStats()        // Aggregate metrics by work_type/reason

// Cleanup
cleanupRetryAttempts(retentionDays = 30)  // Remove success/permanent_failed >30d old
```

### 3. Comprehensive Testing

**Integration Tests** (`src/test/retryEngine.integration.test.js`)

- Schema validation (4 tables present)
- Backoff calculation (exponential, linear, fixed, capping)
- Error classification (transient, permanent, network, rate limit, validation)
- Retry attempt recording with status/error/metadata
- Retry vs quarantine decision logic
- Quarantine management (create, retrieve, filter, update)
- Recovery operations (initiate, mark succeeded/failed, payload override)
- Retry policy management (predefined policies, validation)
- Statistics and reporting (retry stats, quarantine stats)
- Cleanup operations (retention-based old record removal)
- Integration scenario (full retry → quarantine → recovery flow)

**70+ test cases** covering:
- All backoff strategies with exponential capping
- All error classification heuristics
- Transient vs permanent decision logic
- Quarantine CRUD operations
- Recovery audit trail creation
- Policy retrieval and validation
- Statistics aggregation
- Cleanup with retention boundaries

## Usage Examples

### Record Retry Attempt

```javascript
const { recordRetryAttempt, classifyError, handleRetryOrQuarantine } = 
  require("./src/services/retryEngine");

try {
  await sendEmail(user);
} catch (error) {
  const result = await recordRetryAttempt("email", emailId, {
    attemptNumber: 1,
    status: "failed_transient",
    errorCode: error.code,
    errorMessage: error.message,
    errorClassification: classifyError(error, error.code).errorClassification,
    backoffStrategy: "exponential",
    backoffMultiplier: 1.5,
    metadata: { userId: user.id }
  });
  
  console.log(`Retry scheduled in ${result.backoff_seconds}s`);
}
```

### Handle Retry vs Quarantine

```javascript
const { handleRetryOrQuarantine } = require("./src/services/retryEngine");

try {
  await processPayment(order);
} catch (error) {
  const decision = await handleRetryOrQuarantine("payment", orderId, {
    attemptNumber: currentAttempt,
    maxAttempts: 3,
    error,
    errorCode: error.statusCode,
    errorMessage: error.message,
    payload: order,
    retryPolicy: await getRetryPolicy("api_call")
  });
  
  if (decision.action === "retry") {
    console.log(`Retry ${decision.nextAttempt} scheduled`);
  } else {
    console.log(`Quarantined: ${decision.reason}`);
  }
}
```

### Recover from Quarantine

```javascript
const { 
  getQuarantineItem, 
  initiateRecovery, 
  markRecoverySucceeded 
} = require("./src/services/retryEngine");

// Inspect failed work
const quarantined = await getQuarantineItem("email", emailId);
console.log(`Failed: ${quarantined.permanent_error_message}`);
console.log(`Payload: ${JSON.stringify(quarantined.payload)}`);

// Fix and retry
const recovery = await initiateRecovery(quarantined.id, {
  operationType: "fix_and_retry",
  initiatedBy: "ops@company.com",
  payloadOverride: { ...quarantined.payload, fixedField: true }
});

try {
  // Process fixed payload
  await processEmail(recovery.payload_override);
  
  await markRecoverySucceeded(recovery.id, "Processed successfully");
} catch (error) {
  await markRecoveryFailed(recovery.id, error.message);
}
```

### Query Quarantine by Status

```javascript
const { getQuarantineQueue } = require("./src/services/retryEngine");

// Get all waiting recoveries
const waiting = await getQuarantineQueue("webhook", {
  recoveryStatus: "waiting"
});

// Get items by reason
const maxRetried = await getQuarantineQueue("api_call", {
  reason: "max_retries_exceeded",
  limit: 100
});

// Get critical items (by tag)
const critical = await getQuarantineQueue("email", {
  tag: "critical"
});
```

### Get Statistics

```javascript
const { getRetryStats, getQuarantineStats } = require("./src/services/retryEngine");

// Retry attempts breakdown (24h)
const retryStats = await getRetryStats("email");
// [{status: 'success', count: 1200, avg_duration_ms: 2500},
//  {status: 'failed_transient', count: 45, avg_duration_ms: 1800},
//  {status: 'failed_permanent', count: 8, ...}]

// Quarantine breakdown
const quarantineStats = await getQuarantineStats();
// [{work_type: 'email', reason: 'permanent_error', count: 12,
//   avg_recovery_attempts: 1.5, oldest_item: '2026-08-01T10:00:00Z'},
//  ...]
```

## Integration with PR B (Job Registry)

**Retry Policy in Job Registry**

Each job in `job_registry.retry_policy` references one of the predefined policies:

```javascript
const job = await getJob("emailFollowupTask");
// job.retry_policy = {strategy: "exponential", maxAttempts: 3, backoffSeconds: 60}

const policy = await getRetryPolicy(job.retry_policy.strategy);
// Use policy's initial_backoff_seconds, backoff_multiplier, etc.
```

**Lock Tracking + Retry**

When `jobLockTracker.detectStuckLocks()` finds a lock held too long:
1. Mark lock as TIMED_OUT
2. Log attempt to retry_attempts with error_code: "LOCK_TIMEOUT"
3. Trigger retry using the job's retry_policy

## Integration with Stage 5 PRs

**Foundation for PR D (Deferred Events)**
- Outbox processor uses retry engine for event delivery
- Failed events quarantined with full payload for replay

**Foundation for PR E (Health Checks)**
- Health check includes quarantine stats
- Alerts on quarantine overflow (>100 items waiting recovery)

**Foundation for PR F (Logs & Metrics)**
- retry_attempts and quarantine_queue feed metrics pipeline
- Backoff distribution, quarantine reasons tracked

**Foundation for PR G (Backup & Restore)**
- Quarantine queue backed up with recovery operations audit trail
- Can restore quarantined items from backup

## Files Modified/Created

### Created
- `db/migrations/20260802_99_retry_engine_quarantine.sql` — Structure fondatrice
- `db/migrations/20260803_00_retry_engine_quarantine.sql` — Normalisation additive
- `src/services/retryEngine.js` — Retry engine service (500+ lines)
- `src/test/retryEngine.integration.test.js` — Integration tests (600+ lines)
- `docs/PR-C-RETRY-ENGINE-QUARANTINE.md` — This documentation

### Modified
- None (backward compatible, additive only)

## Production Readiness

### Deployment
- New schema tables created via migration
- No changes to existing tables
- Can be deployed independently of PR B

### Configuration
- 6 predefined retry policies auto-inserted
- Each policy optimized for different scenarios
- Customizable via database updates

### Monitoring
- Full audit trail in recovery_operations
- Statistics aggregation for metrics pipelines
- Quarantine queue queryable for dashboards

### Alerting
- Mark quarantine items with tags for filtering
- Monitor queue size (getQuarantineStats returns counts)
- Track recovery_status transitions in operations

## Error Classification Heuristics

**Transient (Retry)**
- 50x server errors
- 429 rate limit
- 408 request timeout
- ECONNREFUSED, ENOTFOUND, ETIMEDOUT
- Unknown errors (default to transient)

**Permanent (Quarantine)**
- 401 unauthorized
- 403 forbidden
- 404 not found
- 422 unprocessable entity
- Custom codes in policy.permanent_error_codes

## Next Steps (PR C Follow-up)

1. **Event Processing**: Integrate with outbox worker
   - Record retry attempts for failed event delivery
   - Quarantine permanently failed events

2. **Dashboard**: Quarantine status UI
   - View waiting items by work type
   - Initiate manual recoveries with payload override
   - Track recovery_operations history

3. **Notifications**: Alert on quarantine growth
   - Slack: Daily summary of quarantine queue
   - Email: Alert when work_type has >50 waiting items

4. **Metrics Reporting**: SLA metrics for retry behavior
   - Success rate by work type
   - Average retries before success
   - Quarantine recovery rate

## References

- **Backoff Strategies**: exponential (2x growth), linear (fixed increment), fixed (constant)
- **Error Classification**: HTTP status codes + message heuristics + policy overrides
- **Quarantine**: Dead letter queue with full payload for deterministic replay
- **Recovery**: Manual operation with optional payload override + audit trail

---

**Status**: ✅ Complete (PR C)  
**Tests**: 70+ integration cases  
**Policies**: 6 predefined + extensible  
**Error Classification**: Heuristic-based + policy overrides  
**Production Ready**: Yes (schema, service, tests)
