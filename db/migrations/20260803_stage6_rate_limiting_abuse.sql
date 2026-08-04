-- Migration: Stage 6 Rate Limiting & Abuse Prevention
-- Rate limiting, DDoS detection, abuse prevention, and traffic management

CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT 'Default organization',
  slug VARCHAR(255) UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table for rate limit policies
CREATE TABLE IF NOT EXISTS rate_limit_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Policy identification
  organization_id VARCHAR(255) NOT NULL,
  policy_name VARCHAR(255) NOT NULL,
  policy_type VARCHAR(50),                      -- 'global', 'endpoint', 'user', 'ip', 'api_key'
  description TEXT,

  -- Rate limiting configuration
  requests_per_second INT,                      -- RPS limit
  requests_per_minute INT,
  requests_per_hour INT,
  requests_per_day INT,
  burst_capacity INT,                          -- Allow temporary burst

  -- Scope
  applies_to VARCHAR(100),                      -- 'all_users', 'authenticated_only', 'specific_role', 'specific_endpoint'
  endpoint_pattern VARCHAR(255),                -- Regex pattern for endpoints
  http_methods JSONB,                          -- ['GET', 'POST']
  exempt_users JSONB,                          -- User IDs exempt from rate limits

  -- Response handling
  return_429_on_limit BOOLEAN DEFAULT true,    -- Return 429 Too Many Requests
  return_retry_after BOOLEAN DEFAULT true,     -- Include Retry-After header
  queue_requests BOOLEAN DEFAULT false,         -- Queue excess requests instead of rejecting

  -- Enforcement
  is_active BOOLEAN DEFAULT true,
  enforcement_type VARCHAR(50),                 -- 'strict', 'soft', 'warning'
  enforce_globally BOOLEAN DEFAULT false,      -- Enforce across all servers

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(organization_id, policy_name),
  CONSTRAINT fk_rate_policy_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rate_policies_active ON rate_limit_policies(is_active);
CREATE INDEX IF NOT EXISTS idx_rate_policies_org ON rate_limit_policies(organization_id);

-- Table for rate limit tracking
CREATE TABLE IF NOT EXISTS rate_limit_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  rate_limit_policy_id UUID NOT NULL REFERENCES rate_limit_policies(id) ON DELETE CASCADE,
  user_id VARCHAR(255),                        -- NULL for IP-based limiting
  api_key_id UUID,                             -- For API key based limiting
  ip_address INET,
  organization_id VARCHAR(255) NOT NULL,

  -- Request counting
  requests_in_window INT DEFAULT 0,
  requests_this_second INT DEFAULT 0,
  requests_this_minute INT DEFAULT 0,
  requests_this_hour INT DEFAULT 0,
  requests_this_day INT DEFAULT 0,

  -- Window tracking
  window_reset_at TIMESTAMP WITH TIME ZONE,
  last_request_at TIMESTAMP WITH TIME ZONE,
  burst_requests_used INT DEFAULT 0,

  -- Violation tracking
  limit_exceeded_count INT DEFAULT 0,
  last_limit_exceeded_at TIMESTAMP WITH TIME ZONE,
  is_currently_limited BOOLEAN DEFAULT false,
  limited_until TIMESTAMP WITH TIME ZONE,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(rate_limit_policy_id, user_id, api_key_id, ip_address),
  CONSTRAINT fk_tracking_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracking_policy ON rate_limit_tracking(rate_limit_policy_id);
CREATE INDEX IF NOT EXISTS idx_tracking_user ON rate_limit_tracking(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_tracking_ip ON rate_limit_tracking(ip_address);
CREATE INDEX IF NOT EXISTS idx_tracking_limited ON rate_limit_tracking(is_currently_limited);

-- Table for abuse detection and alerts
CREATE TABLE IF NOT EXISTS abuse_detection_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Alert identification
  organization_id VARCHAR(255) NOT NULL,
  alert_type VARCHAR(100),                     -- 'brute_force', 'credential_stuffing', 'bot_activity', 'ddos', 'api_abuse', 'spam', 'scraping'
  severity_level VARCHAR(50),                  -- 'critical', 'high', 'medium', 'low', 'info'

  -- Source identification
  source_ip INET,
  source_user_id VARCHAR(255),
  source_api_key_id UUID,
  user_agent TEXT,
  geolocation JSONB,

  -- Abuse details
  detected_behavior TEXT,
  violation_count INT DEFAULT 1,
  abnormal_pattern_description TEXT,
  confidence_score DECIMAL(3,2),               -- 0.0 to 1.0

  -- Detection method
  detection_method VARCHAR(100),               -- 'rate_limit', 'pattern_matching', 'anomaly_detection', 'heuristic', 'manual'

  -- Response and tracking
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_alert_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  is_blocked BOOLEAN DEFAULT false,
  blocked_at TIMESTAMP WITH TIME ZONE,
  block_reason TEXT,
  block_duration_minutes INT,
  unblocked_at TIMESTAMP WITH TIME ZONE,

  -- Resolution
  status VARCHAR(50),                          -- 'open', 'investigating', 'confirmed', 'false_positive', 'resolved', 'escalated'
  resolution_notes TEXT,

  -- Metadata
  alert_metadata JSONB,

  CONSTRAINT fk_abuse_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_abuse_org ON abuse_detection_alerts(organization_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_abuse_type ON abuse_detection_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_abuse_severity ON abuse_detection_alerts(severity_level);
CREATE INDEX IF NOT EXISTS idx_abuse_status ON abuse_detection_alerts(status);
CREATE INDEX IF NOT EXISTS idx_abuse_ip ON abuse_detection_alerts(source_ip);
CREATE INDEX IF NOT EXISTS idx_abuse_active ON abuse_detection_alerts(is_active);

-- Table for IP allowlist/blocklist
CREATE TABLE IF NOT EXISTS ip_access_control (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  organization_id VARCHAR(255) NOT NULL,
  ip_address INET NOT NULL,
  ip_range CIDR,                               -- For CIDR ranges
  list_type VARCHAR(50),                       -- 'allowlist', 'blocklist'
  reason VARCHAR(255),

  -- Configuration
  applies_to VARCHAR(100),                     -- 'all', 'api_only', 'admin_panel', 'specific_endpoint'
  endpoint_pattern VARCHAR(255),

  -- Scope
  is_permanent BOOLEAN DEFAULT false,
  expires_at TIMESTAMP WITH TIME ZONE,        -- NULL for permanent
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  added_by VARCHAR(255),
  last_modified_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT fk_ip_access_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ip_access_org ON ip_access_control(organization_id);
CREATE INDEX IF NOT EXISTS idx_ip_access_ip ON ip_access_control(ip_address);
CREATE INDEX IF NOT EXISTS idx_ip_access_type ON ip_access_control(list_type, is_active);

-- Table for DDoS/traffic anomaly detection
CREATE TABLE IF NOT EXISTS traffic_anomaly_detection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Anomaly identification
  organization_id VARCHAR(255) NOT NULL,
  anomaly_type VARCHAR(100),                  -- 'traffic_spike', 'unusual_pattern', 'distributed_attack', 'slow_attack', 'resource_exhaustion'
  severity_level VARCHAR(50),

  -- Detection details
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detection_confidence DECIMAL(3,2),          -- 0.0 to 1.0
  anomaly_description TEXT,

  -- Traffic metrics
  baseline_rps DECIMAL(10,2),                 -- Normal requests per second
  peak_rps DECIMAL(10,2),                     -- During anomaly
  spike_percentage INT,                        -- Percentage above baseline
  affected_endpoints JSONB,                    -- Which endpoints affected
  affected_regions JSONB,                      -- Geographic regions

  -- Attack characteristics
  unique_ips_count INT,
  unique_users_count INT,
  request_patterns JSONB,
  user_agent_patterns JSONB,

  -- Response actions
  mitigation_started_at TIMESTAMP WITH TIME ZONE,
  mitigation_method VARCHAR(100),             -- 'rate_limit_increase', 'ip_block', 'captcha', 'circuit_breaker', 'manual'
  mitigation_applied BOOLEAN DEFAULT false,
  traffic_restored_at TIMESTAMP WITH TIME ZONE,

  -- Status
  status VARCHAR(50),                         -- 'detected', 'mitigating', 'mitigated', 'investigating'

  CONSTRAINT fk_anomaly_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_anomaly_org ON traffic_anomaly_detection(organization_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_severity ON traffic_anomaly_detection(severity_level);

-- Table for bot detection and management
CREATE TABLE IF NOT EXISTS bot_detection_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Bot identification
  organization_id VARCHAR(255) NOT NULL,
  bot_id VARCHAR(255),
  source_ip INET,
  user_agent TEXT,
  request_signature VARCHAR(255),             -- Fingerprint of bot requests

  -- Bot classification
  bot_type VARCHAR(100),                      -- 'search_engine', 'monitoring', 'malicious', 'scraper', 'unknown'
  confidence_score DECIMAL(3,2),

  -- Behavior tracking
  first_detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  total_requests INT DEFAULT 0,
  request_rate_per_minute DECIMAL(10,2),

  -- Detection method
  detection_method VARCHAR(100),              -- 'ua_parsing', 'behavioral_analysis', 'captcha', 'ip_reputation', 'pattern_matching'

  -- Action taken
  action VARCHAR(50),                         -- 'allowed', 'rate_limited', 'blocked', 'challenged'
  block_reason TEXT,
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  metadata JSONB,

  CONSTRAINT fk_bot_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bot_org ON bot_detection_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_bot_type ON bot_detection_records(bot_type);
CREATE INDEX IF NOT EXISTS idx_bot_ip ON bot_detection_records(source_ip);

-- Table for request throttling queue
CREATE TABLE IF NOT EXISTS throttle_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Queue entry
  organization_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255),
  api_key_id UUID,
  ip_address INET,

  -- Request details
  http_method VARCHAR(10),
  request_path VARCHAR(500),
  request_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retry_after_seconds INT,
  queue_position INT,

  -- Processing status
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMP WITH TIME ZONE,
  processing_result VARCHAR(50),              -- 'success', 'failure', 'timeout', 'expired'

  -- Metadata
  request_size_bytes INT,
  priority INT DEFAULT 0,

  CONSTRAINT fk_queue_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_queue_org ON throttle_queue(organization_id);
CREATE INDEX IF NOT EXISTS idx_queue_processed ON throttle_queue(processed);
CREATE INDEX IF NOT EXISTS idx_queue_timestamp ON throttle_queue(request_timestamp);

-- View for rate limit summary
CREATE OR REPLACE VIEW rate_limit_summary AS
SELECT
  organization_id,
  COUNT(DISTINCT rate_limit_policy_id) as total_policies,
  COUNT(CASE WHEN is_currently_limited = true THEN 1 END) as currently_limited_entities,
  COUNT(DISTINCT user_id) as tracked_users,
  COUNT(DISTINCT ip_address) as tracked_ips,
  MAX(last_limit_exceeded_at) as most_recent_limit_exceeded
FROM rate_limit_tracking
GROUP BY organization_id;

-- View for abuse detection summary
CREATE OR REPLACE VIEW abuse_detection_summary AS
SELECT
  organization_id,
  alert_type,
  COUNT(*) as total_alerts,
  COUNT(CASE WHEN is_active = true THEN 1 END) as active_alerts,
  COUNT(CASE WHEN is_blocked = true THEN 1 END) as blocked_entities,
  COUNT(CASE WHEN severity_level = 'critical' THEN 1 END) as critical_alerts,
  AVG(confidence_score) as avg_confidence,
  MAX(detected_at) as most_recent_alert
FROM abuse_detection_alerts
GROUP BY organization_id, alert_type;

-- View for traffic anomaly summary
CREATE OR REPLACE VIEW traffic_anomaly_summary AS
SELECT
  organization_id,
  anomaly_type,
  COUNT(*) as total_anomalies,
  COUNT(CASE WHEN status = 'detected' THEN 1 END) as active_anomalies,
  AVG(spike_percentage) as avg_spike_percentage,
  MAX(peak_rps) as max_peak_rps,
  MAX(detected_at) as most_recent_anomaly
FROM traffic_anomaly_detection
WHERE detected_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY organization_id, anomaly_type;

-- Update trigger for rate limit policies
CREATE OR REPLACE FUNCTION update_rate_policy_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rate_policy_update ON rate_limit_policies;
CREATE TRIGGER rate_policy_update BEFORE UPDATE ON rate_limit_policies
FOR EACH ROW EXECUTE FUNCTION update_rate_policy_timestamp();

-- Update trigger for rate limit tracking
DROP TRIGGER IF EXISTS tracking_update ON rate_limit_tracking;
CREATE TRIGGER tracking_update BEFORE UPDATE ON rate_limit_tracking
FOR EACH ROW EXECUTE FUNCTION update_rate_policy_timestamp();

-- Comments
COMMENT ON TABLE rate_limit_policies IS 'Define rate limiting policies per organization and scope';
COMMENT ON TABLE rate_limit_tracking IS 'Track rate limit usage per user/API key/IP';
COMMENT ON TABLE abuse_detection_alerts IS 'Alert on abusive behavior (brute force, DDoS, scraping, spam)';
COMMENT ON TABLE ip_access_control IS 'Allowlist/blocklist IP addresses for access control';
COMMENT ON TABLE traffic_anomaly_detection IS 'Detect and track traffic anomalies and DDoS attacks';
COMMENT ON TABLE bot_detection_records IS 'Identify and track bot activity';
COMMENT ON TABLE throttle_queue IS 'Queue excess requests when rate limited';
