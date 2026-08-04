/**
 * Issue #174 PR E: Authentication & Sessions Service
 *
 * Session management, authentication methods, device tracking, 2FA, and password policies
 */

const db = require("../../db");
const crypto = require("crypto");

/**
 * Create or update session configuration
 */
async function configureSessionPolicy(organizationId, sessionType, config = {}) {
  try {
    const {
      sessionName = sessionType,
      sessionTimeoutMinutes = 30,
      sessionMaxDurationMinutes = 480,
      sessionRenewalWindowMinutes = 5,
      requireTwofa = false,
      requireDeviceFingerprint = false,
      requireGeolocationMatch = false,
      requireIpWhitelist = false,
      concurrentSessionLimit = null,
      allowRememberedDevices = true,
      maxRememberedDevicesPerUser = 5,
      requireDeviceApproval = false
    } = config;

    const query = `
      INSERT INTO session_configurations (
        organization_id, session_type, session_name,
        session_timeout_minutes, session_max_duration_minutes,
        session_renewal_window_minutes, require_twofa,
        require_device_fingerprint, require_geolocation_match,
        require_ip_whitelist, concurrent_session_limit,
        allow_remembered_devices, max_remembered_devices_per_user,
        require_device_approval
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (organization_id, session_type)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id, session_name;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      sessionType,
      sessionName,
      sessionTimeoutMinutes,
      sessionMaxDurationMinutes,
      sessionRenewalWindowMinutes,
      requireTwofa,
      requireDeviceFingerprint,
      requireGeolocationMatch,
      requireIpWhitelist,
      concurrentSessionLimit,
      allowRememberedDevices,
      maxRememberedDevicesPerUser,
      requireDeviceApproval
    ]);

    return {
      configured: true,
      policy_id: result.rows[0].id,
      session_name: result.rows[0].session_name
    };
  } catch (error) {
    console.error("Error configuring session policy:", error);
    return { configured: false, error: error.message };
  }
}

/**
 * Create a new user session
 */
async function createSession(userId, organizationId, sessionConfig = {}) {
  try {
    const {
      sessionType = "web",
      sessionName = "Session",
      deviceId = null,
      deviceFingerprint = null,
      deviceName = null,
      deviceType = "desktop",
      deviceOs = null,
      deviceBrowser = null,
      ipAddress = null,
      userAgent = null,
      geolocation = null,
      authenticationMethod = "password",
      sessionMetadata = null
    } = sessionConfig;

    // Generate session token
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const sessionTokenHash = crypto
      .createHash("sha256")
      .update(sessionToken)
      .digest("hex");

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 30);

    const query = `
      INSERT INTO user_sessions (
        user_id, organization_id, organisation_id, session_token,
        session_type, session_name,
        device_id, device_fingerprint, device_name, device_type,
        device_os, device_browser, ip_address, user_agent,
        geolocation, authentication_method, expires_at,
        session_metadata, authenticated_at
      ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      userId,
      organizationId,
      sessionTokenHash,
      sessionType,
      sessionName,
      deviceId,
      deviceFingerprint,
      deviceName,
      deviceType,
      deviceOs,
      deviceBrowser,
      ipAddress,
      userAgent,
      JSON.stringify(geolocation),
      authenticationMethod,
      expiresAt,
      JSON.stringify(sessionMetadata),
      organizationId
    ]);

    return {
      created: true,
      session_id: result.rows[0].id,
      session_token: sessionToken,
      expires_at: expiresAt.toISOString()
    };
  } catch (error) {
    console.error("Error creating session:", error);
    return { created: false, error: error.message };
  }
}

/**
 * Verify session token and update activity
 */
async function validateSession(sessionTokenHash, userId, organizationId) {
  try {
    const query = `
      SELECT id, user_id, organization_id, is_active, is_expired, is_revoked, expires_at
      FROM user_sessions
      WHERE session_token = $1 AND user_id = $2 AND organization_id = $3
    `;

    const result = await db.pool.query(query, [sessionTokenHash, userId, organizationId]);

    if (result.rows.length === 0) {
      return { valid: false, reason: "session_not_found" };
    }

    const session = result.rows[0];

    if (!session.is_active) {
      return { valid: false, reason: "session_not_active" };
    }

    if (session.is_revoked) {
      return { valid: false, reason: "session_revoked" };
    }

    if (new Date() > new Date(session.expires_at)) {
      return { valid: false, reason: "session_expired" };
    }

    // Update last activity
    await db.pool.query(
      `UPDATE user_sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [session.id]
    );

    return {
      valid: true,
      session_id: session.id,
      user_id: session.user_id,
      organization_id: session.organization_id
    };
  } catch (error) {
    console.error("Error validating session:", error);
    return { valid: false, error: error.message };
  }
}

/**
 * Revoke session
 */
async function revokeSession(sessionId, reason = "") {
  try {
    const query = `
      UPDATE user_sessions
      SET is_revoked = true, revoke_reason = $2, revoked_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id;
    `;

    const result = await db.pool.query(query, [sessionId, reason]);

    if (result.rows.length === 0) {
      return { revoked: false, reason: "session_not_found" };
    }

    return {
      revoked: true,
      session_id: sessionId
    };
  } catch (error) {
    console.error("Error revoking session:", error);
    return { revoked: false, error: error.message };
  }
}

/**
 * Register authentication method for user
 */
async function registerAuthenticationMethod(userId, organizationId, authMethodType, config = {}) {
  try {
    const {
      isPrimary = false,
      isBackup = false,
      methodData = null,
      twoFaSecret = null,
      twoFaBackupCodes = null,
      apiKeyHash = null,
      apiKeyName = null,
      phone = null,
      email = null
    } = config;

    const query = `
      INSERT INTO authentication_methods (
        user_id, organization_id, auth_method_type,
        is_primary, is_backup, method_data,
        twofa_backup_codes_generated, api_key_hash, api_key_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id, auth_method_type)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      userId,
      organizationId,
      authMethodType,
      isPrimary,
      isBackup,
      JSON.stringify(methodData),
      twoFaBackupCodes ? true : false,
      apiKeyHash,
      apiKeyName
    ]);

    return {
      registered: true,
      method_id: result.rows[0].id,
      auth_method_type: authMethodType
    };
  } catch (error) {
    console.error("Error registering authentication method:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Create API key
 */
async function createApiKey(userId, organizationId, keyName, scope, config = {}) {
  try {
    const {
      keyType = "personal",
      rotationIntervalDays = 90,
      expiresInDays = 365
    } = config;

    // Generate API key
    const apiKey = crypto.randomBytes(32).toString("base64");
    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const nextRotation = new Date();
    nextRotation.setDate(nextRotation.getDate() + rotationIntervalDays);

    const query = `
      INSERT INTO api_keys (
        user_id, organization_id, api_key_name,
        api_key_hash, key_type, scope,
        expires_at, next_rotation_at, rotation_interval_days
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      userId,
      organizationId,
      keyName,
      apiKeyHash,
      keyType,
      scope,
      expiresAt,
      nextRotation,
      rotationIntervalDays
    ]);

    return {
      created: true,
      api_key_id: result.rows[0].id,
      api_key: apiKey,
      api_key_name: keyName,
      expires_at: expiresAt.toISOString()
    };
  } catch (error) {
    console.error("Error creating API key:", error);
    return { created: false, error: error.message };
  }
}

/**
 * Log authentication event
 */
async function logAuthenticationEvent(eventType, eventConfig = {}) {
  try {
    const {
      userId = null,
      organizationId = null,
      usernameAttempted = null,
      authenticationMethod = null,
      ipAddress = null,
      userAgent = null,
      deviceId = null,
      success = false,
      failureReason = null,
      isSuspicious = false,
      sessionId = null,
      metadata = null
    } = eventConfig;

    const query = `
      INSERT INTO authentication_events (
        user_id, organization_id, event_type, username_attempted,
        authentication_method, ip_address, user_agent, device_id,
        success, failure_reason, is_suspicious, session_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      userId,
      organizationId,
      eventType,
      usernameAttempted,
      authenticationMethod,
      ipAddress,
      userAgent,
      deviceId,
      success,
      failureReason,
      isSuspicious,
      sessionId,
      JSON.stringify(metadata)
    ]);

    return {
      logged: true,
      event_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error logging authentication event:", error);
    return { logged: false, error: error.message };
  }
}

/**
 * Register trusted device
 */
async function registerTrustedDevice(userId, organizationId, deviceConfig = {}) {
  try {
    const {
      deviceId = null,
      deviceFingerprint = null,
      deviceName = null,
      deviceType = "desktop",
      deviceOs = null,
      deviceBrowser = null,
      lastIpAddress = null,
      trustApprovedBy = null,
      trustApprovalMethod = "manual"
    } = deviceConfig;

    const effectiveDeviceId = deviceId || deviceFingerprint || crypto.randomUUID();

    const query = `
      INSERT INTO trusted_devices (
        user_id, organization_id, device_id, device_fingerprint,
        device_name, device_type, device_os, device_browser,
        last_ip_address, is_trusted, trust_approved_at, trust_approved_by,
        trust_approval_method, last_seen_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, CURRENT_TIMESTAMP, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, device_fingerprint)
      DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP, is_trusted = true
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      userId,
      organizationId,
      effectiveDeviceId,
      deviceFingerprint,
      deviceName,
      deviceType,
      deviceOs,
      deviceBrowser,
      lastIpAddress,
      trustApprovedBy,
      trustApprovalMethod
    ]);

    return {
      registered: true,
      device_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error registering trusted device:", error);
    return { registered: false, error: error.message };
  }
}

/**
 * Configure 2FA for user
 */
async function configureTwoFactor(userId, organizationId, twoFaMethod, config = {}) {
  try {
    const {
      totpSecret = null,
      totpBackupCodes = null,
      phoneNumber = null,
      emailAddress = null,
      hardwareKeyType = null,
      hardwareKeyId = null,
      requireAlways = false,
      requireForSensitiveOps = true,
      trustedDeviceBypass = true
    } = config;

    const query = `
      INSERT INTO twofactor_configuration (
        user_id, organization_id, twofa_method,
        totp_secret, totp_backup_codes, phone_number, email_address,
        hardware_key_type, hardware_key_id,
        require_always, require_for_sensitive_operations,
        trusted_device_bypass, setup_completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, twofa_method)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      userId,
      organizationId,
      twoFaMethod,
      totpSecret,
      totpBackupCodes ? Array.from(totpBackupCodes) : null,
      phoneNumber,
      emailAddress,
      hardwareKeyType,
      hardwareKeyId,
      requireAlways,
      requireForSensitiveOps,
      trustedDeviceBypass
    ]);

    return {
      configured: true,
      twofa_id: result.rows[0].id,
      twofa_method: twoFaMethod
    };
  } catch (error) {
    console.error("Error configuring 2FA:", error);
    return { configured: false, error: error.message };
  }
}

/**
 * Set password policy for organization
 */
async function setPasswordPolicy(organizationId, policyConfig = {}) {
  try {
    const {
      policyName = "Default Policy",
      minLength = 12,
      requireUppercase = true,
      requireLowercase = true,
      requireNumbers = true,
      requireSpecialChars = true,
      rememberHistoryCount = 5,
      passwordExpiryDays = 90,
      passwordWarningDays = 14,
      maxLoginAttempts = 5,
      lockoutDurationMinutes = 15,
      minStrengthScore = 3
    } = policyConfig;

    const query = `
      INSERT INTO password_policies (
        organization_id, policy_name,
        min_length, require_uppercase, require_lowercase,
        require_numbers, require_special_chars,
        remember_history_count, password_expiry_days,
        password_warning_days, max_login_attempts,
        lockout_duration_minutes, min_strength_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (organization_id)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      policyName,
      minLength,
      requireUppercase,
      requireLowercase,
      requireNumbers,
      requireSpecialChars,
      rememberHistoryCount,
      passwordExpiryDays,
      passwordWarningDays,
      maxLoginAttempts,
      lockoutDurationMinutes,
      minStrengthScore
    ]);

    return {
      set: true,
      policy_id: result.rows[0].id,
      policy_name: policyName
    };
  } catch (error) {
    console.error("Error setting password policy:", error);
    return { set: false, error: error.message };
  }
}

/**
 * Record password change
 */
async function recordPasswordChange(userId, organizationId, passwordHash, changeType = "user_change") {
  try {
    const query = `
      INSERT INTO password_history (
        user_id, organization_id, password_hash,
        password_change_type, changed_at
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      userId,
      organizationId,
      passwordHash,
      changeType
    ]);

    return {
      recorded: true,
      history_id: result.rows[0].id
    };
  } catch (error) {
    console.error("Error recording password change:", error);
    return { recorded: false, error: error.message };
  }
}

/**
 * Configure SSO provider
 */
async function configureSsoProvider(organizationId, providerName, providerType, config = {}) {
  try {
    const {
      displayName = providerName,
      clientId = null,
      clientSecret = null,
      providerUrl = null,
      metadataUrl = null,
      metadata = null,
      isPrimaryAuth = false,
      autoProvisionUsers = true,
      syncUserRoles = false,
      syncUserGroups = false
    } = config;

    const query = `
      INSERT INTO sso_configurations (
        organization_id, provider_name, provider_type,
        display_name, client_id, client_secret,
        provider_url, metadata_url, metadata,
        is_primary_auth, auto_provision_users,
        sync_user_roles, sync_user_groups
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (organization_id, provider_name)
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

    const result = await db.pool.query(query, [
      organizationId,
      providerName,
      providerType,
      displayName,
      clientId,
      clientSecret,
      providerUrl,
      metadataUrl,
      JSON.stringify(metadata),
      isPrimaryAuth,
      autoProvisionUsers,
      syncUserRoles,
      syncUserGroups
    ]);

    return {
      configured: true,
      provider_id: result.rows[0].id,
      provider_name: providerName
    };
  } catch (error) {
    console.error("Error configuring SSO provider:", error);
    return { configured: false, error: error.message };
  }
}

/**
 * Get active sessions for user
 */
async function getActiveUserSessions(userId, organizationId) {
  try {
    const query = `
      SELECT id, session_type, device_name, ip_address, created_at, last_activity_at, expires_at
      FROM user_sessions
      WHERE user_id = $1 AND organization_id = $2
      AND is_active = true AND is_expired = false AND is_revoked = false
      ORDER BY last_activity_at DESC
    `;

    const result = await db.pool.query(query, [userId, organizationId]);

    return {
      sessions: result.rows
    };
  } catch (error) {
    console.error("Error getting active sessions:", error);
    return { error: error.message };
  }
}

/**
 * Get authentication summary
 */
async function getAuthenticationSummary() {
  try {
    const query = `SELECT * FROM authentication_summary`;
    const result = await db.pool.query(query);

    return {
      summary: result.rows
    };
  } catch (error) {
    console.error("Error getting authentication summary:", error);
    return { error: error.message };
  }
}

/**
 * Get active sessions summary
 */
async function getActiveSessionsSummary() {
  try {
    const query = `SELECT * FROM active_sessions_summary`;
    const result = await db.pool.query(query);

    return {
      summary: result.rows
    };
  } catch (error) {
    console.error("Error getting sessions summary:", error);
    return { error: error.message };
  }
}

/**
 * Get API key status
 */
async function getApiKeyStatus(userId) {
  try {
    const query = `SELECT * FROM api_key_status_summary WHERE user_id = $1`;
    const result = await db.pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return { found: false };
    }

    return {
      found: true,
      status: result.rows[0]
    };
  } catch (error) {
    console.error("Error getting API key status:", error);
    return { found: false, error: error.message };
  }
}

module.exports = {
  configureSessionPolicy,
  createSession,
  validateSession,
  revokeSession,
  registerAuthenticationMethod,
  createApiKey,
  logAuthenticationEvent,
  registerTrustedDevice,
  configureTwoFactor,
  setPasswordPolicy,
  recordPasswordChange,
  configureSsoProvider,
  getActiveUserSessions,
  getAuthenticationSummary,
  getActiveSessionsSummary,
  getApiKeyStatus
};