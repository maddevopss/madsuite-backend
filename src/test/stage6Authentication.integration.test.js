/**
 * Issue #174 PR E: Authentication & Sessions Integration Tests
 *
 * Test cases for:
 * - Session configuration and policies
 * - User session creation, validation, and revocation
 * - Authentication methods (password, 2FA, SSO, API keys)
 * - Device management and trust
 * - Authentication event logging
 * - Password policies and history
 * - Two-factor authentication configuration
 * - API key management and rotation
 * - SSO provider configuration
 */

const db = require("../../db");
const authService = require("../services/authenticationSessionService");
const crypto = require("crypto");

describe("Stage 6: Authentication & Sessions", () => {
  const testOrgId = "550e8400-e29b-41d4-a716-446655440003";
  const testUserId = "user-auth-001";
  const testUserIdOther = "user-auth-002";

  beforeAll(async () => {
    try {
      await db.pool.query(
        `INSERT INTO organizations (id, name, slug)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [testOrgId, "Auth Test Org", "auth-test"]
      );
    } catch (error) {
      console.log("Setup warning:", error.message);
    }
  });

  afterAll(async () => {
    try {
      await db.pool.query(`DELETE FROM user_sessions WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM authentication_events WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM authentication_methods WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM api_keys WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM trusted_devices WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM twofactor_configuration WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM password_history WHERE organization_id = $1`, [testOrgId]);
      await db.pool.query(`DELETE FROM sso_configurations WHERE organization_id = $1`, [testOrgId]);
    } catch (error) {
      console.log("Cleanup warning:", error.message);
    }
  });

  describe("Session Configuration", () => {
    test("Configure web session policy", async () => {
      const result = await authService.configureSessionPolicy(
        testOrgId,
        "web",
        {
          sessionName: "Web Session",
          sessionTimeoutMinutes: 30,
          sessionMaxDurationMinutes: 480,
          requireTwofa: false,
          requireDeviceFingerprint: false
        }
      );

      expect(result.configured).toBe(true);
      expect(result.session_name).toBe("Web Session");
    });

    test("Configure mobile session policy with stricter requirements", async () => {
      const result = await authService.configureSessionPolicy(
        testOrgId,
        "mobile",
        {
          sessionName: "Mobile App Session",
          sessionTimeoutMinutes: 15,
          requireTwofa: true,
          requireDeviceFingerprint: true,
          concurrentSessionLimit: 2
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Configure API session policy", async () => {
      const result = await authService.configureSessionPolicy(
        testOrgId,
        "api",
        {
          sessionName: "API Session",
          sessionTimeoutMinutes: 60,
          requireTwofa: false,
          concurrentSessionLimit: null
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Configure admin session policy with maximum security", async () => {
      const result = await authService.configureSessionPolicy(
        testOrgId,
        "admin",
        {
          sessionName: "Admin Session",
          sessionTimeoutMinutes: 10,
          sessionMaxDurationMinutes: 120,
          requireTwofa: true,
          requireDeviceFingerprint: true,
          requireGeolocationMatch: true,
          requireIpWhitelist: true,
          requireDeviceApproval: true,
          concurrentSessionLimit: 1
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Update existing session policy", async () => {
      const first = await authService.configureSessionPolicy(
        testOrgId,
        "update_test",
        { sessionTimeoutMinutes: 30 }
      );

      const second = await authService.configureSessionPolicy(
        testOrgId,
        "update_test",
        { sessionTimeoutMinutes: 60 }
      );

      expect(first.configured).toBe(true);
      expect(second.configured).toBe(true);
    });

    test("Configure device management settings", async () => {
      const result = await authService.configureSessionPolicy(
        testOrgId,
        "device_test",
        {
          allowRememberedDevices: true,
          maxRememberedDevicesPerUser: 5,
          requireDeviceApproval: false
        }
      );

      expect(result.configured).toBe(true);
    });
  });

  describe("Session Management", () => {
    test("Create web session", async () => {
      const result = await authService.createSession(
        testUserId,
        testOrgId,
        {
          sessionType: "web",
          sessionName: "Chrome Web Session",
          deviceType: "desktop",
          deviceBrowser: "Chrome",
          authenticationMethod: "password"
        }
      );

      expect(result.created).toBe(true);
      expect(result.session_token).toBeDefined();
      expect(result.expires_at).toBeDefined();
    });

    test("Create mobile session with device info", async () => {
      const result = await authService.createSession(
        testUserId,
        testOrgId,
        {
          sessionType: "mobile",
          deviceType: "mobile",
          deviceName: "iPhone 14",
          deviceOs: "iOS 17",
          deviceBrowser: "Safari",
          deviceId: "device-mobile-001"
        }
      );

      expect(result.created).toBe(true);
    });

    test("Create API session", async () => {
      const result = await authService.createSession(
        testUserIdOther,
        testOrgId,
        {
          sessionType: "api",
          sessionName: "API Access",
          authenticationMethod: "api_key"
        }
      );

      expect(result.created).toBe(true);
    });

    test("Create session with geolocation", async () => {
      const result = await authService.createSession(
        testUserId,
        testOrgId,
        {
          sessionType: "web",
          geolocation: {
            latitude: 40.7128,
            longitude: -74.0060,
            city: "New York",
            country: "USA"
          }
        }
      );

      expect(result.created).toBe(true);
    });

    test("Create session with IP address and user agent", async () => {
      const result = await authService.createSession(
        testUserId,
        testOrgId,
        {
          sessionType: "web",
          ipAddress: "192.168.1.100",
          userAgent: "Mozilla/5.0..."
        }
      );

      expect(result.created).toBe(true);
    });

    test("Validate active session", async () => {
      const session = await authService.createSession(
        testUserId,
        testOrgId,
        { sessionType: "web" }
      );

      // Hash the token as it would be stored
      const tokenHash = crypto
        .createHash("sha256")
        .update(session.session_token)
        .digest("hex");

      const result = await authService.validateSession(
        tokenHash,
        testUserId,
        testOrgId
      );

      expect(result.valid).toBe(true);
      expect(result.session_id).toBeDefined();
    });

    test("Reject invalid session token", async () => {
      const result = await authService.validateSession(
        "invalid_token_hash",
        testUserId,
        testOrgId
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("session_not_found");
    });

    test("Revoke session", async () => {
      const session = await authService.createSession(
        testUserId,
        testOrgId,
        { sessionType: "web" }
      );

      // Get session ID from database
      const sessionId = session.session_id || (await db.pool.query(
        `SELECT id FROM user_sessions WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
        [testUserId, testOrgId]
      )).rows[0]?.id;

      if (sessionId) {
        const result = await authService.revokeSession(sessionId, "logout");
        expect(result.revoked).toBe(true);
      }
    });

    test("Get active sessions for user", async () => {
      // Create multiple sessions
      for (let i = 0; i < 3; i++) {
        await authService.createSession(
          testUserId,
          testOrgId,
          { sessionType: "web", sessionName: `Session ${i}` }
        );
      }

      const result = await authService.getActiveUserSessions(testUserId, testOrgId);

      expect(Array.isArray(result.sessions)).toBe(true);
    });
  });

  describe("Authentication Methods", () => {
    test("Register password authentication method", async () => {
      const result = await authService.registerAuthenticationMethod(
        testUserId,
        testOrgId,
        "password",
        { isPrimary: true }
      );

      expect(result.registered).toBe(true);
      expect(result.auth_method_type).toBe("password");
    });

    test("Register TOTP 2FA method", async () => {
      const result = await authService.registerAuthenticationMethod(
        testUserId,
        testOrgId,
        "2fa_totp",
        {
          methodData: { secret: "JBSWY3DPEBLW64TMMQ======" }
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register SMS 2FA method", async () => {
      const result = await authService.registerAuthenticationMethod(
        testUserId,
        testOrgId,
        "2fa_sms",
        {
          methodData: { phone: "+1234567890" }
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register SSO method", async () => {
      const result = await authService.registerAuthenticationMethod(
        testUserId,
        testOrgId,
        "sso_oauth",
        {
          methodData: { provider: "google", provider_id: "google-12345" }
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register API key authentication", async () => {
      const result = await authService.registerAuthenticationMethod(
        testUserIdOther,
        testOrgId,
        "api_key",
        {
          apiKeyHash: "hash_of_key_123",
          apiKeyName: "Production API Key"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register backup authentication method", async () => {
      const result = await authService.registerAuthenticationMethod(
        testUserId,
        testOrgId,
        "2fa_email",
        { isBackup: true }
      );

      expect(result.registered).toBe(true);
    });
  });

  describe("API Key Management", () => {
    test("Create API key", async () => {
      const result = await authService.createApiKey(
        testUserId,
        testOrgId,
        "My API Key",
        "read:users,write:reports"
      );

      expect(result.created).toBe(true);
      expect(result.api_key).toBeDefined();
      expect(result.api_key_id).toBeDefined();
    });

    test("Create API key with custom expiry", async () => {
      const result = await authService.createApiKey(
        testUserId,
        testOrgId,
        "Short-lived Key",
        "read:data",
        { expiresInDays: 30 }
      );

      expect(result.created).toBe(true);
    });

    test("Create personal API key", async () => {
      const result = await authService.createApiKey(
        testUserId,
        testOrgId,
        "Personal Key",
        "read:self",
        { keyType: "personal" }
      );

      expect(result.created).toBe(true);
    });

    test("Create service account API key", async () => {
      const result = await authService.createApiKey(
        "service-account-bot",
        testOrgId,
        "Bot API Key",
        "write:logs,read:metrics",
        { keyType: "service_account" }
      );

      expect(result.created).toBe(true);
    });

    test("Create integration API key", async () => {
      const result = await authService.createApiKey(
        testUserId,
        testOrgId,
        "Slack Integration",
        "read:channels,write:messages",
        { keyType: "integration" }
      );

      expect(result.created).toBe(true);
    });

    test("Get API key status", async () => {
      await authService.createApiKey(testUserId, testOrgId, "Key A", "read:*");
      await authService.createApiKey(testUserId, testOrgId, "Key B", "write:*");

      const result = await authService.getApiKeyStatus(testUserId);

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status.active_keys).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Authentication Event Logging", () => {
    test("Log successful login", async () => {
      const result = await authService.logAuthenticationEvent(
        "login_success",
        {
          userId: testUserId,
          organizationId: testOrgId,
          authenticationMethod: "password",
          ipAddress: "192.168.1.100",
          success: true
        }
      );

      expect(result.logged).toBe(true);
    });

    test("Log failed login attempt", async () => {
      const result = await authService.logAuthenticationEvent(
        "login_failed",
        {
          usernameAttempted: "testuser",
          organizationId: testOrgId,
          authenticationMethod: "password",
          ipAddress: "192.168.1.200",
          success: false,
          failureReason: "Invalid password"
        }
      );

      expect(result.logged).toBe(true);
    });

    test("Log 2FA verification", async () => {
      const result = await authService.logAuthenticationEvent(
        "twofa_verified",
        {
          userId: testUserId,
          organizationId: testOrgId,
          authenticationMethod: "2fa_totp",
          success: true
        }
      );

      expect(result.logged).toBe(true);
    });

    test("Log failed 2FA attempt", async () => {
      const result = await authService.logAuthenticationEvent(
        "twofa_failed",
        {
          userId: testUserId,
          organizationId: testOrgId,
          authenticationMethod: "2fa_totp",
          success: false,
          failureReason: "Invalid code"
        }
      );

      expect(result.logged).toBe(true);
    });

    test("Log suspicious authentication activity", async () => {
      const result = await authService.logAuthenticationEvent(
        "suspicious_activity",
        {
          userId: testUserId,
          organizationId: testOrgId,
          ipAddress: "192.168.99.99",
          isSuspicious: true,
          metadata: {
            reason: "unusual location",
            risk_score: 8
          }
        }
      );

      expect(result.logged).toBe(true);
    });

    test("Get authentication summary", async () => {
      const result = await authService.getAuthenticationSummary();

      expect(Array.isArray(result.summary)).toBe(true);
    });
  });

  describe("Device Management", () => {
    test("Register trusted device", async () => {
      const result = await authService.registerTrustedDevice(
        testUserId,
        testOrgId,
        {
          deviceName: "MacBook Pro",
          deviceType: "desktop",
          deviceOs: "macOS 14",
          deviceBrowser: "Chrome",
          trustApprovedBy: "admin@example.com"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register mobile device as trusted", async () => {
      const result = await authService.registerTrustedDevice(
        testUserId,
        testOrgId,
        {
          deviceName: "iPhone 14",
          deviceType: "mobile",
          deviceOs: "iOS 17",
          deviceBrowser: "Safari",
          deviceFingerprint: "fingerprint_mobile_001"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register tablet as trusted device", async () => {
      const result = await authService.registerTrustedDevice(
        testUserId,
        testOrgId,
        {
          deviceName: "iPad Pro",
          deviceType: "tablet",
          deviceOs: "iPadOS 17",
          deviceBrowser: "Safari"
        }
      );

      expect(result.registered).toBe(true);
    });

    test("Register device with approval method", async () => {
      const result = await authService.registerTrustedDevice(
        testUserId,
        testOrgId,
        {
          deviceName: "New Device",
          trustApprovalMethod: "email"
        }
      );

      expect(result.registered).toBe(true);
    });
  });

  describe("Two-Factor Authentication", () => {
    test("Configure TOTP 2FA", async () => {
      const result = await authService.configureTwoFactor(
        testUserId,
        testOrgId,
        "totp",
        {
          totpSecret: "JBSWY3DPEBLW64TMMQ======",
          totpBackupCodes: ["code1", "code2", "code3", "code4", "code5"]
        }
      );

      expect(result.configured).toBe(true);
      expect(result.twofa_method).toBe("totp");
    });

    test("Configure SMS 2FA", async () => {
      const result = await authService.configureTwoFactor(
        testUserId,
        testOrgId,
        "sms",
        {
          phoneNumber: "+1-555-123-4567"
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Configure email 2FA", async () => {
      const result = await authService.configureTwoFactor(
        testUserId,
        testOrgId,
        "email",
        {
          emailAddress: "user@example.com"
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Configure hardware key 2FA", async () => {
      const result = await authService.configureTwoFactor(
        testUserId,
        testOrgId,
        "hardware_key",
        {
          hardwareKeyType: "fido2",
          hardwareKeyId: "key-12345"
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Configure push notification 2FA", async () => {
      const result = await authService.configureTwoFactor(
        testUserId,
        testOrgId,
        "push",
        {
          pushProvider: "firebase",
          pushDeviceTokens: ["token1", "token2"]
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Configure 2FA with always-required setting", async () => {
      const result = await authService.configureTwoFactor(
        testUserId,
        testOrgId,
        "totp_required",
        {
          totpSecret: "secret",
          requireAlways: true,
          trustedDeviceBypass: false
        }
      );

      expect(result.configured).toBe(true);
    });
  });

  describe("Password Policies", () => {
    test("Set basic password policy", async () => {
      const result = await authService.setPasswordPolicy(
        testOrgId,
        {
          policyName: "Basic Policy",
          minLength: 8,
          requireUppercase: true,
          requireNumbers: true
        }
      );

      expect(result.set).toBe(true);
    });

    test("Set strong password policy", async () => {
      const result = await authService.setPasswordPolicy(
        testOrgId,
        {
          policyName: "Strong Policy",
          minLength: 16,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSpecialChars: true,
          passwordExpiryDays: 90,
          maxLoginAttempts: 3,
          lockoutDurationMinutes: 30
        }
      );

      expect(result.set).toBe(true);
    });

    test("Set password policy with history", async () => {
      const result = await authService.setPasswordPolicy(
        testOrgId,
        {
          policyName: "History Policy",
          rememberHistoryCount: 10,
          passwordExpiryDays: 60
        }
      );

      expect(result.set).toBe(true);
    });

    test("Set password policy with warnings", async () => {
      const result = await authService.setPasswordPolicy(
        testOrgId,
        {
          policyName: "Warning Policy",
          passwordExpiryDays: 90,
          passwordWarningDays: 14
        }
      );

      expect(result.set).toBe(true);
    });
  });

  describe("Password Management", () => {
    test("Record password change", async () => {
      const result = await authService.recordPasswordChange(
        testUserId,
        testOrgId,
        "hash_of_new_password_123"
      );

      expect(result.recorded).toBe(true);
    });

    test("Record password reset", async () => {
      const result = await authService.recordPasswordChange(
        testUserId,
        testOrgId,
        "hash_of_reset_password",
        "admin_reset"
      );

      expect(result.recorded).toBe(true);
    });

    test("Record forced password change", async () => {
      const result = await authService.recordPasswordChange(
        testUserId,
        testOrgId,
        "hash_of_forced_password",
        "forced_reset"
      );

      expect(result.recorded).toBe(true);
    });
  });

  describe("SSO Configuration", () => {
    test("Configure SAML SSO provider", async () => {
      const result = await authService.configureSsoProvider(
        testOrgId,
        "corporate_saml",
        "saml",
        {
          displayName: "Corporate SSO",
          metadataUrl: "https://idp.example.com/metadata",
          isPrimaryAuth: true,
          autoProvisionUsers: true
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Configure Azure AD SSO", async () => {
      const result = await authService.configureSsoProvider(
        testOrgId,
        "azure_ad",
        "azure_ad",
        {
          displayName: "Azure Active Directory",
          clientId: "azure-client-id",
          providerUrl: "https://login.microsoftonline.com"
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Configure Google OAuth", async () => {
      const result = await authService.configureSsoProvider(
        testOrgId,
        "google_oauth",
        "google",
        {
          displayName: "Sign in with Google",
          clientId: "google-client-id",
          providerUrl: "https://accounts.google.com"
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Configure Okta SSO", async () => {
      const result = await authService.configureSsoProvider(
        testOrgId,
        "okta",
        "okta",
        {
          displayName: "Okta",
          providerUrl: "https://org.okta.com",
          metadataUrl: "https://org.okta.com/app/metadata.xml"
        }
      );

      expect(result.configured).toBe(true);
    });

    test("Configure SSO with user provisioning", async () => {
      const result = await authService.configureSsoProvider(
        testOrgId,
        "sso_provision",
        "saml",
        {
          autoProvisionUsers: true,
          syncUserRoles: true,
          syncUserGroups: true
        }
      );

      expect(result.configured).toBe(true);
    });
  });

  describe("Integration Scenarios", () => {
    test("Complete authentication workflow: configure -> create session -> log event", async () => {
      // Configure policy
      const policyResult = await authService.configureSessionPolicy(
        testOrgId,
        "workflow_test",
        { sessionTimeoutMinutes: 30 }
      );

      // Create session
      const sessionResult = await authService.createSession(
        testUserId,
        testOrgId,
        { sessionType: "workflow_test" }
      );

      // Log event
      const eventResult = await authService.logAuthenticationEvent(
        "login_success",
        {
          userId: testUserId,
          organizationId: testOrgId,
          success: true
        }
      );

      expect(policyResult.configured).toBe(true);
      expect(sessionResult.created).toBe(true);
      expect(eventResult.logged).toBe(true);
    });

    test("2FA setup and verification workflow", async () => {
      // Configure 2FA
      const configResult = await authService.configureTwoFactor(
        testUserId,
        testOrgId,
        "workflow_totp",
        { totpSecret: "secret" }
      );

      // Log verification event
      const eventResult = await authService.logAuthenticationEvent(
        "twofa_verified",
        {
          userId: testUserId,
          organizationId: testOrgId,
          success: true
        }
      );

      expect(configResult.configured).toBe(true);
      expect(eventResult.logged).toBe(true);
    });

    test("Device trust workflow: register -> create session", async () => {
      // Register device
      const deviceResult = await authService.registerTrustedDevice(
        testUserId,
        testOrgId,
        {
          deviceName: "Workflow Device",
          deviceFingerprint: "workflow_fingerprint"
        }
      );

      // Create session on trusted device
      const sessionResult = await authService.createSession(
        testUserId,
        testOrgId,
        {
          deviceFingerprint: "workflow_fingerprint",
          sessionType: "web"
        }
      );

      expect(deviceResult.registered).toBe(true);
      expect(sessionResult.created).toBe(true);
    });

    test("API key lifecycle: create -> log events", async () => {
      // Create API key
      const keyResult = await authService.createApiKey(
        testUserId,
        testOrgId,
        "Workflow Key",
        "read:*"
      );

      // Log authentication with API key
      const eventResult = await authService.logAuthenticationEvent(
        "login_success",
        {
          userId: testUserId,
          organizationId: testOrgId,
          authenticationMethod: "api_key",
          success: true
        }
      );

      // Get key status
      const statusResult = await authService.getApiKeyStatus(testUserId);

      expect(keyResult.created).toBe(true);
      expect(eventResult.logged).toBe(true);
      expect(statusResult.found).toBe(true);
    });

    test("SSO configuration and usage workflow", async () => {
      // Configure SSO
      const ssoResult = await authService.configureSsoProvider(
        testOrgId,
        "workflow_sso",
        "saml",
        { displayName: "Workflow SSO" }
      );

      // Register SSO auth method
      const authResult = await authService.registerAuthenticationMethod(
        testUserId,
        testOrgId,
        "sso_saml",
        { methodData: { provider: "workflow" } }
      );

      // Log SSO login
      const eventResult = await authService.logAuthenticationEvent(
        "login_success",
        {
          userId: testUserId,
          organizationId: testOrgId,
          authenticationMethod: "sso_saml",
          success: true
        }
      );

      expect(ssoResult.configured).toBe(true);
      expect(authResult.registered).toBe(true);
      expect(eventResult.logged).toBe(true);
    });
  });

  describe("Query Functions", () => {
    test("Get active sessions summary", async () => {
      const result = await authService.getActiveSessionsSummary();

      expect(Array.isArray(result.summary)).toBe(true);
    });

    test("Get authentication summary with event types", async () => {
      const result = await authService.getAuthenticationSummary();

      expect(Array.isArray(result.summary)).toBe(true);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("Handle multiple authentication methods for same user", async () => {
      const methods = ["password", "2fa_totp", "api_key"];

      for (const method of methods) {
        const result = await authService.registerAuthenticationMethod(
          testUserId,
          testOrgId,
          method
        );
        expect(result.registered).toBe(true);
      }
    });

    test("Handle session creation with minimal config", async () => {
      const result = await authService.createSession(testUserId, testOrgId);

      expect(result.created).toBe(true);
    });

    test("Handle API key creation with various scopes", async () => {
      const scopes = ["read:*", "write:*", "read:users,write:reports"];

      for (const scope of scopes) {
        const result = await authService.createApiKey(
          testUserId,
          testOrgId,
          `Key-${scope}`,
          scope
        );
        expect(result.created).toBe(true);
      }
    });

    test("Handle rapid session creation", async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          authService.createSession(testUserId, testOrgId, {
            sessionName: `Session ${i}`
          })
        );
      }

      const results = await Promise.all(promises);
      expect(results.every(r => r.created === true)).toBe(true);
    });

    test("Handle concurrent authentication events", async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          authService.logAuthenticationEvent(
            `event_${i}`,
            {
              userId: testUserId,
              organizationId: testOrgId,
              success: i % 2 === 0
            }
          )
        );
      }

      const results = await Promise.all(promises);
      expect(results.every(r => r.logged === true)).toBe(true);
    });

    test("Handle 2FA configuration updates", async () => {
      const initial = await authService.configureTwoFactor(
        testUserId,
        testOrgId,
        "update_test",
        { totpSecret: "secret1" }
      );

      const updated = await authService.configureTwoFactor(
        testUserId,
        testOrgId,
        "update_test",
        { totpSecret: "secret2" }
      );

      expect(initial.configured).toBe(true);
      expect(updated.configured).toBe(true);
    });
  });

  describe("Security and Compliance", () => {
    test("Track failed login attempts", async () => {
      for (let i = 0; i < 3; i++) {
        await authService.logAuthenticationEvent(
          "login_failed",
          {
            usernameAttempted: "user@example.com",
            authenticationMethod: "password",
            success: false,
            failureReason: "Invalid password"
          }
        );
      }

      const summary = await authService.getAuthenticationSummary();
      expect(Array.isArray(summary.summary)).toBe(true);
    });

    test("Track authentication from different locations", async () => {
      const locations = [
        "192.168.1.100",
        "192.168.1.200",
        "203.0.113.0",
        "198.51.100.0"
      ];

      for (const ip of locations) {
        await authService.logAuthenticationEvent(
          "login_success",
          {
            userId: testUserId,
            organizationId: testOrgId,
            ipAddress: ip,
            success: true
          }
        );
      }

      const summary = await authService.getAuthenticationSummary();
      expect(Array.isArray(summary.summary)).toBe(true);
    });

    test("Track device-specific authentication", async () => {
      const devices = ["device-1", "device-2", "device-3"];

      for (const device of devices) {
        await authService.createSession(
          testUserId,
          testOrgId,
          { deviceId: device, sessionType: "web" }
        );
      }

      const sessions = await authService.getActiveUserSessions(testUserId, testOrgId);
      expect(Array.isArray(sessions.sessions)).toBe(true);
    });
  });
});
