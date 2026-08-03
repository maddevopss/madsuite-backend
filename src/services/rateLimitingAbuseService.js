/**
 * Issue #174 PR G: Rate Limiting & Abuse Prevention Service
 *
 * Rate limiting policies, abuse detection, DDoS prevention, and traffic management
 */

const db = require("../../db");
const crypto = require("crypto");

/**
 * Create rate limit policy
 */
async function createRateLimitPolicy(organizationId, policyName, policyConfig = {}) {
  try {
    const {
      policyType = "global",
      description = "",
      requestsPerSecond = null,
      requestsPerMinute = 60,
      requestsPerHour = 3600,
      requestsPerDay = null,
      burstCapacity = null,
      appliesToEndpoint = "all",
      endpointPattern = null,
      httpMethods = null,
      exemptUsers = null,
      return429OnLimit = true,
      returnRetryAfter = true,
      queueRequests = false,
      enforcementType = "strict",
      enforceGlobally = false
    } = policyConfig;

    const query = `
      INSERT INTO rate_limit_policies (
        organization_id, policy_name, policy_type, description,
        requests_per_second, requests_per_minute, requests_per_hour,
        requests_per_day, burst_capacity, applies_to, endpoint_pattern,
        http_methods, exempt_users, return_429_on_limit,
        return_retry_after, queue_requests, enforcement_type,
        enforce_globally
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (organization_id, policy_name)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id, policy_name;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      policyName,
      policyType,
      description,
      requestsPerSecond,
      requestsPerMinute,
      requestsPerHour,
      requestsPerDay,
      burstCapacity,
      appliesToEndpoint,
      endpointPattern,
      JSON.stringify(httpMethods),
      JSON.stringify(exemptUsers),
      return429OnLimit,
      returnRetryAfter,
      queueRequests,
      enforcementType,
      enforceGlobally
    ]);

    return {
      created: true,
      policy_id: result.rows[0].id,
      policy_name: result.rows[0].policy_name
    };
  } catch (error) {
    console.error("Error creating rate limit policy:", error);
    return { created: false, error: error.message };
  }
}

/**
 * Check rate limit and update tracking
 */
async function checkRateLimit(policyId, userId, apiKeyId, ipAddress, organizationId) {
  try {
    // Get policy details
    const policyResult = await db.pool.query(
      `SELECT requests_per_second, requests_per_minute, requests_per_hour FROM rate_limit_policies WHERE id = $1`,
      [policyId]
    );

    if (policyResult.rows.length === 0) {
      return { allowed: true, reason: "policy_not_found" };
    }

    const policy = policyResult.rows[0];

    // Check or create tracking record
    const trackingResult = await db.pool.query(
      `SELECT * FROM rate_limit_tracking
       WHERE rate_limit_policy_id = $1 AND user_id = $2 AND api_key_id = $3 AND ip_address = $4`,
      [policyId, userId, apiKeyId, ipAddress]
    );

    let tracking;
    if (trackingResult.rows.length === 0) {
      // Create new tracking record
      const insertResult = await db.pool.query(
        `INSERT INTO rate_limit_tracking (rate_limit_policy_id, user_id, api_key_id, ip_address, organization_id, window_reset_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '1 minute')
         RETURNING *`,
        [policyId, userId, apiKeyId, ipAddress, organizationId]
      );
      tracking = insertResult.rows[0];
    } else {
      tracking = trackingResult.rows[0];
    }

    // Check if currently limited
    if (tracking.is_currently_limited && new Date() < new Date(tracking.limited_until)) {
      return {
        allowed: false,
        reason: "rate_limit_exceeded",
        limited_until: tracking.limited_until,
        retry_after_seconds: Math.ceil((new Date(tracking.limited_until) - new Date()) / 1000)
      };
    }

    // Check request count
    const requestsThisMinute = tracking.requests_this_minute + 1;
    const allowed = requestsThisMinute <= policy.requests_per_minute;

    // Update tracking
    await db.pool.query(
      `UPDATE rate_limit_tracking
       SET requests_this_minute = $2, requests_in_window = $3, last_request_at = CURRENT_TIMESTAMP,
           limit_exceeded_count = CASE WHEN $4 THEN limit_exceeded_count + 1 ELSE limit_exceeded_count END,
           last_limit_exceeded_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE last_limit_exceeded_at END,
           is_currently_limited = $4,
           limited_until = CASE WHEN $4 THEN CURRENT_TIMESTAMP + INTERVAL '1 minute' ELSE NULL END
       WHERE id = $1`,
      [tracking.id, requestsThisMinute, requestsThisMinute, !allowed]
    );

    return {
      allowed: allowed,
      requests_remaining: Math.max(0, policy.requests_per_minute - requestsThisMinute),
      limit: policy.requests_per_minute,
      reset_at: tracking.window_reset_at
    };
  } catch (error) {
    console.error("Error checking rate limit:", error);
    return { allowed: true, error: error.message };
  }
}

/**
 * Record abuse detection alert
 */
async function recordAbuseAlert(organizationId, alertType, alertConfig = {}) {
  try {
    const {
      severityLevel = "medium",
      sourceIp = null,
      sourceUserId = null,
      sourceApiKeyId = null,
      userAgent = null,
      geolocation = null,
      detectedBehavior = "",
      violationCount = 1,
      abnormalPatternDescription = null,
      confidenceScore = 0.7,
      detectionMethod = "heuristic"
    } = alertConfig;

    const query = `
      INSERT INTO abuse_detection_alerts (
        organization_id, alert_type, severity_level,
        source_ip, source_user_id, source_api_key_id,
        user_agent, geolocation, detected_behavior,
        violation_count, abnormal_pattern_description,
        confidence_score, detection_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      alertType,
      severityLevel,
      sourceIp,
      sourceUserId,
      sourceApiKeyId,
      userAgent,
      JSON.stringify(geolocation),
      detectedBehavior,
      violationCount,
      abnormalPatternDescription,
      confidenceScore,
      detectionMethod
    ]);

    return {
      recorded: true,
      alert_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error recording abuse alert:", error);
    return { recorded: false, error: error.message };
  }
}

/**
 * Block entity (user, IP, API key)
 */
async function blockEntity(alertId, organizationId, blockReason, blockDurationMinutes = 60) {
  try {
    const blockedUntil = new Date();
    blockedUntil.setMinutes(blockedUntil.getMinutes() + blockDurationMinutes);

    const query = `
      UPDATE abuse_detection_alerts
      SET is_blocked = true, blocked_at = CURRENT_TIMESTAMP,
          block_reason = $3, block_duration_minutes = $4
      WHERE id = $1 AND organization_id = $2
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      alertId,
      organizationId,
      blockReason,
      blockDurationMinutes
    ]);

    if (result.rows.length === 0) {
      return { blocked: false, reason: "alert_not_found" };
    }

    return {
      blocked: true,
      alert_id: alertId,
      blocked_until: blockedUntil
    };
  } catch (error) {
    console.error("Error blocking entity:", error);
    return { blocked: false, error: error.message };
  }
}

/**
 * Add IP to allowlist or blocklist
 */
async function addIpAccessControl(organizationId, ipAddress, listType, controlConfig = {}) {
  try {
    const {
      ipRange = null,
      reason = "",
      appliesToEndpoint = "all",
      endpointPattern = null,
      isPermanent = true,
      expiresAt = null
    } = controlConfig;

    const query = `
      INSERT INTO ip_access_control (
        organization_id, ip_address, ip_range, list_type,
        reason, applies_to, endpoint_pattern, is_permanent,
        expires_at, added_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      ipAddress,
      ipRange,
      listType,
      reason,
      appliesToEndpoint,
      endpointPattern,
      isPermanent,
      expiresAt,
      "system"
    ]);

    return {
      added: true,
      control_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error adding IP access control:", error);
    return { added: false, error: error.message };
  }
}

/**
 * Detect traffic anomaly
 */
async function detectTrafficAnomaly(organizationId, anomalyConfig = {}) {
  try {
    const {
      anomalyType = "traffic_spike",
      severityLevel = "medium",
      baselineRps = 100,
      peakRps = 1000,
      affectedEndpoints = null,
      affectedRegions = null,
      uniqueIpsCount = 0,
      uniqueUsersCount = 0,
      confidence = 0.8
    } = anomalyConfig;

    const spikePercentage = Math.round(((peakRps - baselineRps) / baselineRps) * 100);

    const query = `
      INSERT INTO traffic_anomaly_detection (
        organization_id, anomaly_type, severity_level,
        detection_confidence, baseline_rps, peak_rps,
        spike_percentage, affected_endpoints, affected_regions,
        unique_ips_count, unique_users_count, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      anomalyType,
      severityLevel,
      confidence,
      baselineRps,
      peakRps,
      spikePercentage,
      JSON.stringify(affectedEndpoints),
      JSON.stringify(affectedRegions),
      uniqueIpsCount,
      uniqueUsersCount,
      "detected"
    ]);

    return {
      detected: true,
      anomaly_id: result.rows[0].id,
      spike_percentage: spikePercentage
    };
  } catch (error) {
    console.error("Error detecting traffic anomaly:", error);
    return { detected: false, error: error.message };
  }
}

/**
 * Record bot detection
 */
async function recordBotDetection(organizationId, botConfig = {}) {
  try {
    const {
      botType = "unknown",
      sourceIp = null,
      userAgent = null,
      confidenceScore = 0.75,
      detectionMethod = "ua_parsing",
      action = "allowed",
      blockReason = null
    } = botConfig;

    const requestSignature = crypto
      .createHash("sha256")
      .update(`${sourceIp}:${userAgent}:${Date.now()}`)
      .digest("hex");

    const query = `
      INSERT INTO bot_detection_records (
        organization_id, bot_type, source_ip, user_agent,
        request_signature, confidence_score, detection_method,
        action, block_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      botType,
      sourceIp,
      userAgent,
      requestSignature,
      confidenceScore,
      detectionMethod,
      action,
      blockReason
    ]);

    return {
      recorded: true,
      bot_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error recording bot detection:", error);
    return { recorded: false, error: error.message };
  }
}

/**
 * Queue request when rate limited
 */
async function queueRequest(organizationId, userId, apiKeyId, ipAddress, requestConfig = {}) {
  try {
    const {
      httpMethod = "GET",
      requestPath = "/",
      retryAfterSeconds = 60,
      requestSizeBytes = 0,
      priority = 0
    } = requestConfig;

    const query = `
      INSERT INTO throttle_queue (
        organization_id, user_id, api_key_id, ip_address,
        http_method, request_path, retry_after_seconds,
        request_size_bytes, priority
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, queue_position;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      userId,
      apiKeyId,
      ipAddress,
      httpMethod,
      requestPath,
      retryAfterSeconds,
      requestSizeBytes,
      priority
    ]);

    return {
      queued: true,
      queue_id: result.rows[0].id,
      queue_position: result.rows[0].queue_position
    };
  } catch (error) {
    console.error("Error queuing request:", error);
    return { queued: false, error: error.message };
  }
}

/**
 * Get rate limit summary
 */
async function getRateLimitSummary(organizationId = null) {
  try {
    let query = `SELECT * FROM rate_limit_summary`;
    const params = [];

    if (organizationId) {
      query += ` WHERE organization_id = $1`;
      params.push(organizationId);
    }

    const result = await db.pool.query(query, params);

    return {
      summary: result.rows
    };
  } catch (error) {
    console.error("Error getting rate limit summary:", error);
    return { error: error.message };
  }
}

/**
 * Get abuse detection summary
 */
async function getAbuseDetectionSummary(organizationId = null) {
  try {
    let query = `SELECT * FROM abuse_detection_summary`;
    const params = [];

    if (organizationId) {
      query += ` WHERE organization_id = $1`;
      params.push(organizationId);
    }

    const result = await db.pool.query(query, params);

    return {
      summary: result.rows
    };
  } catch (error) {
    console.error("Error getting abuse detection summary:", error);
    return { error: error.message };
  }
}

/**
 * Get traffic anomaly summary
 */
async function getTrafficAnomalySummary(organizationId = null) {
  try {
    let query = `SELECT * FROM traffic_anomaly_summary`;
    const params = [];

    if (organizationId) {
      query += ` WHERE organization_id = $1`;
      params.push(organizationId);
    }

    const result = await db.pool.query(query, params);

    return {
      summary: result.rows
    };
  } catch (error) {
    console.error("Error getting traffic anomaly summary:", error);
    return { error: error.message };
  }
}

module.exports = {
  createRateLimitPolicy,
  checkRateLimit,
  recordAbuseAlert,
  blockEntity,
  addIpAccessControl,
  detectTrafficAnomaly,
  recordBotDetection,
  queueRequest,
  getRateLimitSummary,
  getAbuseDetectionSummary,
  getTrafficAnomalySummary
};
