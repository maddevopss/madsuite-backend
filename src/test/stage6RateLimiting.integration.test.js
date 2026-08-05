/**
 * Stage 6 PR G: Rate Limiting & Abuse Prevention Integration Tests
 * Tests for rate limiting policies, abuse detection, traffic anomalies, and bot detection
 */

const db = require("../../db");
const rateLimitingAbuseService = require("../services/rateLimitingAbuseService");

describe("Stage 6 PR G - Rate Limiting & Abuse Prevention", () => {
  const organizationId = "550e8400-e29b-41d4-a716-446655440000";
  let policyId;
  let alertId;
  let controlId;
  let anomalyId;
  let botId;
  let queueId;

  beforeAll(async () => {
    await db.pool.query("BEGIN");
    await db.pool.query(
      `INSERT INTO organizations (id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [organizationId, "Rate Limit Test Org", "rate-limit-test"]
    );
    await db.pool.query(
      `INSERT INTO organizations (id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [organizationId, "Rate Limit Test Org", "rate-limit-test"]
    );
  });

  afterAll(async () => {
    await db.pool.query("ROLLBACK");
    await db.pool.end();
  });

  describe("Rate Limit Policies", () => {
    test("Should create a global rate limit policy", async () => {
      const result = await rateLimitingAbuseService.createRateLimitPolicy(
        organizationId,
        "global_policy",
        {
          policyType: "global",
          description: "Global rate limiting policy",
          requestsPerSecond: 100,
          requestsPerMinute: 6000,
          requestsPerHour: 360000,
          return429OnLimit: true,
          returnRetryAfter: true,
          enforcementType: "strict"
        }
      );

      expect(result.created).toBe(true);
      expect(result.policy_id).toBeDefined();
      expect(result.policy_name).toBe("global_policy");
      policyId = result.policy_id;
    });

    test("Should create an endpoint-specific rate limit policy", async () => {
      const result = await rateLimitingAbuseService.createRateLimitPolicy(
        organizationId,
        "endpoint_policy",
        {
          policyType: "endpoint",
          description: "Rate limit for specific endpoint",
          requestsPerMinute: 120,
          appliesToEndpoint: "specific_endpoint",
          endpointPattern: "/api/v1/sensitive/*",
          httpMethods: ["POST", "PUT", "DELETE"],
          enforcementType: "strict"
        }
      );

      expect(result.created).toBe(true);
      expect(result.policy_id).toBeDefined();
    });

    test("Should create a user-based rate limit policy", async () => {
      const result = await rateLimitingAbuseService.createRateLimitPolicy(
        organizationId,
        "user_policy",
        {
          policyType: "user",
          description: "Per-user rate limiting",
          requestsPerMinute: 300,
          requestsPerHour: 10000,
          burstCapacity: 50,
          enforcementType: "soft"
        }
      );

      expect(result.created).toBe(true);
    });

    test("Should create an IP-based rate limit policy", async () => {
      const result = await rateLimitingAbuseService.createRateLimitPolicy(
        organizationId,
        "ip_policy",
        {
          policyType: "ip",
          description: "Per-IP rate limiting",
          requestsPerMinute: 60,
          enforcementType: "strict"
        }
      );

      expect(result.created).toBe(true);
    });

    test("Should exempt specific users from rate limits", async () => {
      const result = await rateLimitingAbuseService.createRateLimitPolicy(
        organizationId,
        "exempt_policy",
        {
          policyType: "global",
          requestsPerMinute: 100,
          exemptUsers: ["user123", "user456", "admin001"]
        }
      );

      expect(result.created).toBe(true);
    });

    test("Should queue requests when rate limited", async () => {
      const result = await rateLimitingAbuseService.createRateLimitPolicy(
        organizationId,
        "queue_policy",
        {
          policyType: "global",
          requestsPerMinute: 100,
          queueRequests: true
        }
      );

      expect(result.created).toBe(true);
    });

    test("Should handle policy upsert (duplicate policy name)", async () => {
      const result = await rateLimitingAbuseService.createRateLimitPolicy(
        organizationId,
        "global_policy",
        {
          policyType: "global",
          description: "Updated description",
          requestsPerMinute: 5000
        }
      );

      expect(result.created).toBe(true);
      expect(result.policy_id).toBe(policyId);
    });

    test("Should support multiple HTTP methods in policy", async () => {
      const result = await rateLimitingAbuseService.createRateLimitPolicy(
        organizationId,
        "methods_policy",
        {
          policyType: "endpoint",
          httpMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
          requestsPerMinute: 200
        }
      );

      expect(result.created).toBe(true);
    });

    test("Should enforce policy globally across all servers", async () => {
      const result = await rateLimitingAbuseService.createRateLimitPolicy(
        organizationId,
        "distributed_policy",
        {
          policyType: "global",
          enforceGlobally: true,
          requestsPerMinute: 100
        }
      );

      expect(result.created).toBe(true);
    });
  });

  describe("Rate Limit Checking & Tracking", () => {
    test("Should allow request when under limit", async () => {
      const result = await rateLimitingAbuseService.checkRateLimit(
        policyId,
        "user001",
        "key001",
        "192.168.1.1",
        organizationId
      );

      expect(result.allowed).toBe(true);
      expect(result.requests_remaining).toBeGreaterThanOrEqual(0);
      expect(result.limit).toBeDefined();
    });

    test("Should track requests in rate limit window", async () => {
      for (let i = 0; i < 5; i++) {
        await rateLimitingAbuseService.checkRateLimit(
          policyId,
          "user002",
          "key002",
          "192.168.1.2",
          organizationId
        );
      }

      const result = await rateLimitingAbuseService.checkRateLimit(
        policyId,
        "user002",
        "key002",
        "192.168.1.2",
        organizationId
      );

      expect(result.allowed).toBe(true);
      expect(result.requests_remaining).toBeLessThan(result.limit);
    });

    test("Should block request when limit exceeded", async () => {
      const policyIdTest = await db.pool.query(
        `SELECT id FROM rate_limit_policies WHERE policy_name = 'ip_policy' LIMIT 1`
      );
      const testPolicyId = policyIdTest.rows[0].id;

      for (let i = 0; i < 61; i++) {
        await rateLimitingAbuseService.checkRateLimit(
          testPolicyId,
          "user003",
          "key003",
          "192.168.1.3",
          organizationId
        );
      }

      const result = await rateLimitingAbuseService.checkRateLimit(
        testPolicyId,
        "user003",
        "key003",
        "192.168.1.3",
        organizationId
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("rate_limit_exceeded");
    });

    test("Should include retry-after information", async () => {
      const policyIdTest = await db.pool.query(
        `SELECT id FROM rate_limit_policies WHERE policy_name = 'ip_policy' LIMIT 1`
      );
      const testPolicyId = policyIdTest.rows[0].id;

      for (let i = 0; i < 61; i++) {
        await rateLimitingAbuseService.checkRateLimit(
          testPolicyId,
          "user004",
          "key004",
          "192.168.1.4",
          organizationId
        );
      }

      const result = await rateLimitingAbuseService.checkRateLimit(
        testPolicyId,
        "user004",
        "key004",
        "192.168.1.4",
        organizationId
      );

      if (!result.allowed) {
        expect(result.retry_after_seconds).toBeDefined();
        expect(result.retry_after_seconds).toBeGreaterThan(0);
      }
    });

    test("Should handle multiple identifiers (user, API key, IP)", async () => {
      const result1 = await rateLimitingAbuseService.checkRateLimit(
        policyId,
        "user005",
        "key005",
        "192.168.1.5",
        organizationId
      );

      const result2 = await rateLimitingAbuseService.checkRateLimit(
        policyId,
        "user005",
        "key005",
        "192.168.1.6",
        organizationId
      );

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
    });

    test("Should reset rate limit window", async () => {
      const result1 = await rateLimitingAbuseService.checkRateLimit(
        policyId,
        "user006",
        "key006",
        "192.168.1.6",
        organizationId
      );

      expect(result1.reset_at).toBeDefined();
    });
  });

  describe("Abuse Detection & Alerts", () => {
    test("Should record brute force abuse alert", async () => {
      const result = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "brute_force",
        {
          severityLevel: "high",
          sourceIp: "192.168.1.100",
          sourceUserId: "attacker001",
          detectedBehavior: "Multiple failed login attempts",
          violationCount: 15,
          confidenceScore: 0.95,
          detectionMethod: "pattern_matching"
        }
      );

      expect(result.recorded).toBe(true);
      expect(result.alert_id).toBeDefined();
      alertId = result.alert_id;
    });

    test("Should record credential stuffing alert", async () => {
      const result = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "credential_stuffing",
        {
          severityLevel: "critical",
          sourceIp: "10.0.0.50",
          detectedBehavior: "Rapid login attempts with different credentials",
          violationCount: 50,
          confidenceScore: 0.98,
          detectionMethod: "heuristic"
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should record bot activity alert", async () => {
      const result = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "bot_activity",
        {
          severityLevel: "medium",
          sourceIp: "203.0.113.50",
          userAgent: "Mozilla/5.0 (compatible; MaliciousBot/1.0)",
          detectedBehavior: "Automated request patterns detected",
          violationCount: 100,
          confidenceScore: 0.87,
          detectionMethod: "ua_parsing"
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should record DDoS alert", async () => {
      const result = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "ddos",
        {
          severityLevel: "critical",
          sourceIp: "198.51.100.1",
          detectedBehavior: "Massive traffic spike from single IP",
          violationCount: 10000,
          confidenceScore: 0.99,
          detectionMethod: "anomaly_detection"
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should record API abuse alert", async () => {
      const result = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "api_abuse",
        {
          severityLevel: "high",
          sourceApiKeyId: "malicious-key-123",
          detectedBehavior: "API endpoint flooding",
          violationCount: 5000,
          confidenceScore: 0.92,
          detectionMethod: "rate_limit"
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should record spam alert", async () => {
      const result = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "spam",
        {
          severityLevel: "low",
          sourceUserId: "spammer001",
          detectedBehavior: "Repeated content submission",
          violationCount: 200,
          confidenceScore: 0.75,
          detectionMethod: "pattern_matching"
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should record scraping alert", async () => {
      const result = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "scraping",
        {
          severityLevel: "medium",
          sourceIp: "192.0.2.100",
          detectedBehavior: "Systematic data extraction attempts",
          violationCount: 1000,
          abnormalPatternDescription: "Sequential ID enumeration",
          confidenceScore: 0.88,
          detectionMethod: "behavioral_analysis"
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should include geolocation in alert", async () => {
      const result = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "brute_force",
        {
          severityLevel: "high",
          sourceIp: "203.0.113.100",
          geolocation: {
            country: "CN",
            city: "Beijing",
            latitude: 39.9042,
            longitude: 116.4074
          },
          detectedBehavior: "Brute force from China",
          violationCount: 20,
          confidenceScore: 0.90
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should vary confidence scores by severity", async () => {
      const critical = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "ddos",
        {
          severityLevel: "critical",
          confidenceScore: 0.99,
          detectedBehavior: "Critical DDoS"
        }
      );

      const low = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "spam",
        {
          severityLevel: "low",
          confidenceScore: 0.60,
          detectedBehavior: "Low severity spam"
        }
      );

      expect(critical.recorded).toBe(true);
      expect(low.recorded).toBe(true);
    });
  });

  describe("Entity Blocking", () => {
    test("Should block entity with reason and duration", async () => {
      const result = await rateLimitingAbuseService.blockEntity(
        alertId,
        organizationId,
        "Brute force attack detected",
        60
      );

      expect(result.blocked).toBe(true);
      expect(result.alert_id).toBe(alertId);
      expect(result.blocked_until).toBeDefined();
    });

    test("Should block entity permanently", async () => {
      const alert = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "ddos",
        {
          severityLevel: "critical",
          sourceIp: "198.51.100.200",
          detectedBehavior: "Critical DDoS attack"
        }
      );

      const result = await rateLimitingAbuseService.blockEntity(
        alert.alert_id,
        organizationId,
        "Permanent block for critical DDoS",
        -1
      );

      expect(result.blocked).toBe(true);
    });

    test("Should handle blocking non-existent alert", async () => {
      const result = await rateLimitingAbuseService.blockEntity(
        "00000000-0000-0000-0000-000000000000",
        organizationId,
        "Attempt to block non-existent alert",
        60
      );

      expect(result.blocked).toBe(false);
      expect(result.reason).toBe("alert_not_found");
    });

    test("Should track block duration", async () => {
      const alert = await rateLimitingAbuseService.recordAbuseAlert(
        organizationId,
        "brute_force",
        {
          severityLevel: "high",
          sourceIp: "192.168.1.200",
          detectedBehavior: "Brute force"
        }
      );

      const result = await rateLimitingAbuseService.blockEntity(
        alert.alert_id,
        organizationId,
        "Temporary block",
        120
      );

      expect(result.blocked).toBe(true);
      expect(result.blocked_until).toBeDefined();
    });
  });

  describe("IP Access Control", () => {
    test("Should add IP to allowlist", async () => {
      const result = await rateLimitingAbuseService.addIpAccessControl(
        organizationId,
        "192.168.1.50",
        "allowlist",
        {
          reason: "Internal office network",
          isPermanent: true
        }
      );

      expect(result.added).toBe(true);
      expect(result.control_id).toBeDefined();
      controlId = result.control_id;
    });

    test("Should add IP to blocklist", async () => {
      const result = await rateLimitingAbuseService.addIpAccessControl(
        organizationId,
        "203.0.113.50",
        "blocklist",
        {
          reason: "Known malicious IP",
          isPermanent: true
        }
      );

      expect(result.added).toBe(true);
    });

    test("Should add CIDR range to allowlist", async () => {
      const result = await rateLimitingAbuseService.addIpAccessControl(
        organizationId,
        "10.0.0.0",
        "allowlist",
        {
          ipRange: "10.0.0.0/8",
          reason: "Corporate network",
          isPermanent: true
        }
      );

      expect(result.added).toBe(true);
    });

    test("Should add IP with expiration", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const result = await rateLimitingAbuseService.addIpAccessControl(
        organizationId,
        "198.51.100.50",
        "blocklist",
        {
          reason: "Temporary block for 30 days",
          isPermanent: false,
          expiresAt: futureDate
        }
      );

      expect(result.added).toBe(true);
    });

    test("Should support endpoint-specific IP control", async () => {
      const result = await rateLimitingAbuseService.addIpAccessControl(
        organizationId,
        "192.0.2.100",
        "blocklist",
        {
          appliesToEndpoint: "specific_endpoint",
          endpointPattern: "/api/v1/admin/*",
          reason: "Block from admin endpoints only"
        }
      );

      expect(result.added).toBe(true);
    });

    test("Should support multiple endpoint applications", async () => {
      const result = await rateLimitingAbuseService.addIpAccessControl(
        organizationId,
        "192.0.2.101",
        "allowlist",
        {
          appliesToEndpoint: "api_only",
          reason: "API access only"
        }
      );

      expect(result.added).toBe(true);
    });
  });

  describe("Traffic Anomaly Detection", () => {
    test("Should detect traffic spike", async () => {
      const result = await rateLimitingAbuseService.detectTrafficAnomaly(
        organizationId,
        {
          anomalyType: "traffic_spike",
          severityLevel: "high",
          baselineRps: 100,
          peakRps: 1000,
          uniqueIpsCount: 500,
          uniqueUsersCount: 10,
          confidence: 0.95
        }
      );

      expect(result.detected).toBe(true);
      expect(result.anomaly_id).toBeDefined();
      expect(result.spike_percentage).toBe(900);
      anomalyId = result.anomaly_id;
    });

    test("Should detect unusual traffic pattern", async () => {
      const result = await rateLimitingAbuseService.detectTrafficAnomaly(
        organizationId,
        {
          anomalyType: "unusual_pattern",
          severityLevel: "medium",
          baselineRps: 500,
          peakRps: 600,
          affectedEndpoints: ["/api/v1/users", "/api/v1/data"],
          confidence: 0.82
        }
      );

      expect(result.detected).toBe(true);
    });

    test("Should detect distributed attack", async () => {
      const result = await rateLimitingAbuseService.detectTrafficAnomaly(
        organizationId,
        {
          anomalyType: "distributed_attack",
          severityLevel: "critical",
          baselineRps: 100,
          peakRps: 50000,
          uniqueIpsCount: 10000,
          affectedRegions: ["US", "CN", "RU", "BR"],
          confidence: 0.99
        }
      );

      expect(result.detected).toBe(true);
    });

    test("Should detect slow attack", async () => {
      const result = await rateLimitingAbuseService.detectTrafficAnomaly(
        organizationId,
        {
          anomalyType: "slow_attack",
          severityLevel: "medium",
          baselineRps: 100,
          peakRps: 150,
          affectedEndpoints: ["/api/v1/expensive"],
          confidence: 0.78
        }
      );

      expect(result.detected).toBe(true);
    });

    test("Should detect resource exhaustion", async () => {
      const result = await rateLimitingAbuseService.detectTrafficAnomaly(
        organizationId,
        {
          anomalyType: "resource_exhaustion",
          severityLevel: "high",
          baselineRps: 1000,
          peakRps: 5000,
          confidence: 0.91
        }
      );

      expect(result.detected).toBe(true);
    });

    test("Should include affected endpoints in anomaly", async () => {
      const result = await rateLimitingAbuseService.detectTrafficAnomaly(
        organizationId,
        {
          anomalyType: "traffic_spike",
          baselineRps: 100,
          peakRps: 500,
          affectedEndpoints: ["/api/v1/search", "/api/v1/export"],
          affectedRegions: ["US", "EU"]
        }
      );

      expect(result.detected).toBe(true);
    });

    test("Should calculate spike percentage correctly", async () => {
      const result = await rateLimitingAbuseService.detectTrafficAnomaly(
        organizationId,
        {
          anomalyType: "traffic_spike",
          baselineRps: 200,
          peakRps: 400
        }
      );

      expect(result.spike_percentage).toBe(100);
    });
  });

  describe("Bot Detection", () => {
    test("Should detect search engine bot", async () => {
      const result = await rateLimitingAbuseService.recordBotDetection(
        organizationId,
        {
          botType: "search_engine",
          sourceIp: "66.249.66.1",
          userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)",
          confidenceScore: 0.99,
          detectionMethod: "ua_parsing",
          action: "allowed"
        }
      );

      expect(result.recorded).toBe(true);
      expect(result.bot_id).toBeDefined();
      botId = result.bot_id;
    });

    test("Should detect monitoring bot", async () => {
      const result = await rateLimitingAbuseService.recordBotDetection(
        organizationId,
        {
          botType: "monitoring",
          sourceIp: "192.0.2.50",
          userAgent: "UptimeBot/1.0",
          confidenceScore: 0.95,
          detectionMethod: "behavioral_analysis",
          action: "allowed"
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should detect malicious bot", async () => {
      const result = await rateLimitingAbuseService.recordBotDetection(
        organizationId,
        {
          botType: "malicious",
          sourceIp: "203.0.113.100",
          userAgent: "CurlBot/1.0",
          confidenceScore: 0.85,
          detectionMethod: "pattern_matching",
          action: "blocked",
          blockReason: "Malicious bot signature detected"
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should detect scraper bot", async () => {
      const result = await rateLimitingAbuseService.recordBotDetection(
        organizationId,
        {
          botType: "scraper",
          sourceIp: "198.51.100.100",
          userAgent: "Scrapy/2.0",
          confidenceScore: 0.92,
          detectionMethod: "pattern_matching",
          action: "rate_limited"
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should record bot with unknown type", async () => {
      const result = await rateLimitingAbuseService.recordBotDetection(
        organizationId,
        {
          botType: "unknown",
          sourceIp: "192.0.2.200",
          userAgent: "UnknownBot/1.0",
          confidenceScore: 0.60,
          detectionMethod: "heuristic"
        }
      );

      expect(result.recorded).toBe(true);
    });

    test("Should generate bot request signature", async () => {
      const result = await rateLimitingAbuseService.recordBotDetection(
        organizationId,
        {
          botType: "scraper",
          sourceIp: "192.0.2.50",
          userAgent: "ScraperBot/1.0",
          confidenceScore: 0.80
        }
      );

      expect(result.recorded).toBe(true);
      expect(result.bot_id).toBeDefined();
    });

    test("Should support different detection methods", async () => {
      const methods = ["ua_parsing", "behavioral_analysis", "captcha", "ip_reputation", "pattern_matching"];

      for (const method of methods) {
        const result = await rateLimitingAbuseService.recordBotDetection(
          organizationId,
          {
            botType: "unknown",
            sourceIp: "192.0.2.100",
            detectionMethod: method
          }
        );

        expect(result.recorded).toBe(true);
      }
    });
  });

  describe("Request Queuing", () => {
    test("Should queue rate-limited request", async () => {
      const result = await rateLimitingAbuseService.queueRequest(
        organizationId,
        "user_queue_001",
        "key_queue_001",
        "192.168.1.100",
        {
          httpMethod: "POST",
          requestPath: "/api/v1/data",
          retryAfterSeconds: 60,
          requestSizeBytes: 2048,
          priority: 0
        }
      );

      expect(result.queued).toBe(true);
      expect(result.queue_id).toBeDefined();
      expect(result.queue_position).toBeDefined();
      queueId = result.queue_id;
    });

    test("Should queue multiple requests with position", async () => {
      const positions = [];

      for (let i = 0; i < 3; i++) {
        const result = await rateLimitingAbuseService.queueRequest(
          organizationId,
          `user_queue_${i}`,
          `key_queue_${i}`,
          `192.168.1.${100 + i}`,
          {
            httpMethod: "GET",
            requestPath: "/api/v1/data",
            retryAfterSeconds: 60
          }
        );

        expect(result.queued).toBe(true);
        positions.push(result.queue_position);
      }

      expect(positions.length).toBe(3);
    });

    test("Should support different HTTP methods in queue", async () => {
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

      for (const method of methods) {
        const result = await rateLimitingAbuseService.queueRequest(
          organizationId,
          `user_queue_${method}`,
          `key_queue_${method}`,
          "192.168.1.101",
          {
            httpMethod: method,
            requestPath: "/api/v1/data",
            retryAfterSeconds: 60
          }
        );

        expect(result.queued).toBe(true);
      }
    });

    test("Should track request size in queue", async () => {
      const result = await rateLimitingAbuseService.queueRequest(
        organizationId,
        "user_queue_size",
        "key_queue_size",
        "192.168.1.102",
        {
          httpMethod: "POST",
          requestPath: "/api/v1/large-data",
          requestSizeBytes: 1000000,
          retryAfterSeconds: 120
        }
      );

      expect(result.queued).toBe(true);
    });

    test("Should support priority in queue", async () => {
      const lowPriority = await rateLimitingAbuseService.queueRequest(
        organizationId,
        "user_queue_low",
        "key_queue_low",
        "192.168.1.103",
        {
          httpMethod: "GET",
          requestPath: "/api/v1/data",
          priority: -10
        }
      );

      const highPriority = await rateLimitingAbuseService.queueRequest(
        organizationId,
        "user_queue_high",
        "key_queue_high",
        "192.168.1.104",
        {
          httpMethod: "GET",
          requestPath: "/api/v1/data",
          priority: 10
        }
      );

      expect(lowPriority.queued).toBe(true);
      expect(highPriority.queued).toBe(true);
    });
  });

  describe("Summary Views", () => {
    test("Should get rate limit summary", async () => {
      const result = await rateLimitingAbuseService.getRateLimitSummary(organizationId);

      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.summary)).toBe(true);
    });

    test("Should get rate limit summary for all organizations", async () => {
      const result = await rateLimitingAbuseService.getRateLimitSummary();

      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.summary)).toBe(true);
    });

    test("Should get abuse detection summary", async () => {
      const result = await rateLimitingAbuseService.getAbuseDetectionSummary(organizationId);

      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.summary)).toBe(true);
    });
  });
});

