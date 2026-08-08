/**
 * Tests for rateLimitingAbuseService
 * 
 * Tests for:
 * - Rate limit policy creation
 * - Rate limit checking and tracking
 * - Abuse detection and alerting
 * - Entity blocking
 * - IP access control
 * - Traffic anomaly detection
 * - Bot detection
 * - Request queuing
 */

const rateLimitService = require('./rateLimitingAbuseService');
const db = require('../../db');

// Mock database
jest.mock('../../db', () => ({
  pool: {
    query: jest.fn()
  }
}));

describe('rateLimitingAbuseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createRateLimitPolicy', () => {
    it('should create a rate limit policy with default values', async () => {
      db.pool.query.mockResolvedValueOnce({
        rows: [{ id: 'policy-1', policy_name: 'test-policy' }]
      });

      const result = await rateLimitService.createRateLimitPolicy(
        'org-1',
        'test-policy',
        { requestsPerMinute: 100 }
      );

      expect(result.created).toBe(true);
      expect(result.policy_id).toBe('policy-1');
      expect(result.policy_name).toBe('test-policy');
      expect(db.pool.query).toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      db.pool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await rateLimitService.createRateLimitPolicy(
        'org-1',
        'test-policy'
      );

      expect(result.created).toBe(false);
      expect(result.error).toBe('DB Error');
    });
  });

  describe('checkRateLimit', () => {
    it('should allow request when under limit', async () => {
      db.pool.query
        .mockResolvedValueOnce({
          rows: [{ requests_per_minute: 60 }]
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'track-1',
            requests_this_minute: 10,
            is_currently_limited: false,
            window_reset_at: new Date()
          }]
        })
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await rateLimitService.checkRateLimit(
        'policy-1',
        'user-1',
        'key-1',
        '192.168.1.1',
        'org-1'
      );

      expect(result.allowed).toBe(true);
      expect(result.requests_remaining).toBeGreaterThan(0);
    });

    it('should deny request when limit exceeded', async () => {
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 1);

      db.pool.query
        .mockResolvedValueOnce({
          rows: [{ requests_per_minute: 60 }]
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'track-1',
            requests_this_minute: 60,
            is_currently_limited: true,
            limited_until: futureDate,
            window_reset_at: new Date()
          }]
        });

      const result = await rateLimitService.checkRateLimit(
        'policy-1',
        'user-1',
        'key-1',
        '192.168.1.1',
        'org-1'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('rate_limit_exceeded');
      expect(result.retry_after_seconds).toBeGreaterThan(0);
    });

    it('should return policy_not_found when policy does not exist', async () => {
      db.pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await rateLimitService.checkRateLimit(
        'nonexistent-policy',
        'user-1',
        'key-1',
        '192.168.1.1',
        'org-1'
      );

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('policy_not_found');
    });

    it('should handle database errors gracefully', async () => {
      db.pool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await rateLimitService.checkRateLimit(
        'policy-1',
        'user-1',
        'key-1',
        '192.168.1.1',
        'org-1'
      );

      expect(result.allowed).toBe(true);
      expect(result.error).toBe('DB Error');
    });
  });

  describe('recordAbuseAlert', () => {
    it('should record an abuse detection alert', async () => {
      db.pool.query.mockResolvedValueOnce({
        rows: [{ id: 'alert-1' }]
      });

      const result = await rateLimitService.recordAbuseAlert(
        'org-1',
        'suspicious_activity',
        {
          severityLevel: 'high',
          sourceIp: '192.168.1.100',
          detectedBehavior: 'Multiple failed login attempts'
        }
      );

      expect(result.recorded).toBe(true);
      expect(result.alert_id).toBe('alert-1');
    });

    it('should handle database errors when recording abuse alert', async () => {
      db.pool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await rateLimitService.recordAbuseAlert(
        'org-1',
        'suspicious_activity'
      );

      expect(result.recorded).toBe(false);
      expect(result.error).toBe('DB Error');
    });
  });

  describe('blockEntity', () => {
    it('should block an entity', async () => {
      db.pool.query.mockResolvedValueOnce({
        rows: [{ id: 'alert-1' }]
      });

      const result = await rateLimitService.blockEntity(
        'alert-1',
        'org-1',
        'Suspicious activity detected',
        60
      );

      expect(result.blocked).toBe(true);
      expect(result.alert_id).toBe('alert-1');
      expect(result.blocked_until).toBeInstanceOf(Date);
    });

    it('should return alert_not_found when alert does not exist', async () => {
      db.pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await rateLimitService.blockEntity(
        'nonexistent-alert',
        'org-1',
        'Suspicious activity'
      );

      expect(result.blocked).toBe(false);
      expect(result.reason).toBe('alert_not_found');
    });
  });

  describe('addIpAccessControl', () => {
    it('should add IP to allowlist', async () => {
      db.pool.query.mockResolvedValueOnce({
        rows: [{ id: 'control-1' }]
      });

      const result = await rateLimitService.addIpAccessControl(
        'org-1',
        '192.168.1.1',
        'allowlist',
        { reason: 'Trusted partner' }
      );

      expect(result.added).toBe(true);
      expect(result.control_id).toBe('control-1');
    });

    it('should handle database errors when adding IP control', async () => {
      db.pool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await rateLimitService.addIpAccessControl(
        'org-1',
        '192.168.1.1',
        'blocklist'
      );

      expect(result.added).toBe(false);
      expect(result.error).toBe('DB Error');
    });
  });

  describe('detectTrafficAnomaly', () => {
    it('should detect traffic anomaly', async () => {
      db.pool.query.mockResolvedValueOnce({
        rows: [{ id: 'anomaly-1' }]
      });

      const result = await rateLimitService.detectTrafficAnomaly(
        'org-1',
        {
          anomalyType: 'traffic_spike',
          baselineRps: 100,
          peakRps: 1000
        }
      );

      expect(result.detected).toBe(true);
      expect(result.anomaly_id).toBe('anomaly-1');
      expect(result.spike_percentage).toBe(900);
    });

    it('should handle database errors when detecting anomaly', async () => {
      db.pool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await rateLimitService.detectTrafficAnomaly('org-1');

      expect(result.detected).toBe(false);
      expect(result.error).toBe('DB Error');
    });
  });

  describe('recordBotDetection', () => {
    it('should record bot detection', async () => {
      db.pool.query.mockResolvedValueOnce({
        rows: [{ id: 'bot-1' }]
      });

      const result = await rateLimitService.recordBotDetection(
        'org-1',
        {
          botType: 'crawler',
          sourceIp: '192.168.1.50',
          userAgent: 'Googlebot/2.1'
        }
      );

      expect(result.recorded).toBe(true);
      expect(result.bot_id).toBe('bot-1');
    });

    it('should handle database errors when recording bot detection', async () => {
      db.pool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await rateLimitService.recordBotDetection('org-1');

      expect(result.recorded).toBe(false);
      expect(result.error).toBe('DB Error');
    });
  });

  describe('queueRequest', () => {
    it('should queue a rate-limited request', async () => {
      db.pool.query.mockResolvedValueOnce({
        rows: [{ id: 'queue-1', queue_position: 5 }]
      });

      const result = await rateLimitService.queueRequest(
        'org-1',
        'user-1',
        'key-1',
        '192.168.1.1',
        {
          httpMethod: 'POST',
          requestPath: '/api/data',
          retryAfterSeconds: 60
        }
      );

      expect(result.queued).toBe(true);
      expect(result.queue_id).toBe('queue-1');
      expect(result.queue_position).toBe(5);
    });

    it('should handle database errors when queuing request', async () => {
      db.pool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await rateLimitService.queueRequest(
        'org-1',
        'user-1',
        'key-1',
        '192.168.1.1'
      );

      expect(result.queued).toBe(false);
      expect(result.error).toBe('DB Error');
    });
  });

  describe('getRateLimitSummary', () => {
    it('should get rate limit summary for organization', async () => {
      db.pool.query.mockResolvedValueOnce({
        rows: [
          { policy_name: 'policy-1', requests_per_minute: 60 },
          { policy_name: 'policy-2', requests_per_minute: 100 }
        ]
      });

      const result = await rateLimitService.getRateLimitSummary('org-1');

      expect(result.summary).toHaveLength(2);
      expect(result.summary[0].policy_name).toBe('policy-1');
    });

    it('should handle database errors when getting summary', async () => {
      db.pool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await rateLimitService.getRateLimitSummary('org-1');

      expect(result.error).toBe('DB Error');
    });
  });

  describe('getAbuseDetectionSummary', () => {
    it('should get abuse detection summary', async () => {
      db.pool.query.mockResolvedValueOnce({
        rows: [
          { alert_type: 'suspicious_activity', count: 5 }
        ]
      });

      const result = await rateLimitService.getAbuseDetectionSummary('org-1');

      expect(result.summary).toHaveLength(1);
      expect(result.summary[0].alert_type).toBe('suspicious_activity');
    });

    it('should handle database errors when getting abuse summary', async () => {
      db.pool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await rateLimitService.getAbuseDetectionSummary('org-1');

      expect(result.error).toBe('DB Error');
    });
  });

  describe('getTrafficAnomalySummary', () => {
    it('should get traffic anomaly summary', async () => {
      db.pool.query.mockResolvedValueOnce({
        rows: [
          { anomaly_type: 'traffic_spike', severity_level: 'high' }
        ]
      });

      const result = await rateLimitService.getTrafficAnomalySummary('org-1');

      expect(result.summary).toHaveLength(1);
      expect(result.summary[0].anomaly_type).toBe('traffic_spike');
    });

    it('should handle database errors when getting anomaly summary', async () => {
      db.pool.query.mockRejectedValueOnce(new Error('DB Error'));

      const result = await rateLimitService.getTrafficAnomalySummary('org-1');

      expect(result.error).toBe('DB Error');
    });
  });
});
