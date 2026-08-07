/**
 * Phase 7 Batch 7.3: Real-time Analytics
 * Database migration for advanced analytics features
 * 
 * Tables:
 * - real_time_metrics: Real-time metric tracking
 * - analytics_insights: Predictive insights and recommendations
 * - custom_reports: User-defined custom reports
 * - analytics_alerts: Alert configurations and history
 * - metric_snapshots: Historical metric snapshots for trending
 * - insight_interactions: User interactions with insights
 * 
 * Date: 2026-08-06
 * FIXED: Changed UUID to INTEGER to match organisations.id type
 */

-- ============================================================================
-- 1. REAL-TIME METRICS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS real_time_metrics (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  metric_name VARCHAR(255) NOT NULL,
  metric_type VARCHAR(50) NOT NULL, -- 'counter', 'gauge', 'histogram', 'timer'
  metric_value NUMERIC NOT NULL,
  unit VARCHAR(50),
  tags JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for real_time_metrics
CREATE INDEX IF NOT EXISTS idx_real_time_metrics_org_id ON real_time_metrics(organisation_id);
CREATE INDEX IF NOT EXISTS idx_real_time_metrics_user_id ON real_time_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_real_time_metrics_name ON real_time_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_real_time_metrics_timestamp ON real_time_metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_real_time_metrics_org_timestamp ON real_time_metrics(organisation_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_real_time_metrics_tags ON real_time_metrics USING GIN(tags);

-- RLS Policy for real_time_metrics
ALTER TABLE real_time_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY real_time_metrics_org_isolation ON real_time_metrics
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- Trigger for updated_at
CREATE TRIGGER real_time_metrics_updated_at
  BEFORE UPDATE ON real_time_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 2. ANALYTICS INSIGHTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS analytics_insights (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  insight_type VARCHAR(100) NOT NULL, -- 'trend', 'anomaly', 'prediction', 'recommendation'
  title VARCHAR(255) NOT NULL,
  description TEXT,
  insight_data JSONB NOT NULL,
  confidence_score NUMERIC DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  relevance_score NUMERIC DEFAULT 0.5 CHECK (relevance_score >= 0 AND relevance_score <= 1),
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'archived', 'dismissed'
  action_url VARCHAR(500),
  action_label VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for analytics_insights
CREATE INDEX IF NOT EXISTS idx_analytics_insights_org_id ON analytics_insights(organisation_id);
CREATE INDEX IF NOT EXISTS idx_analytics_insights_user_id ON analytics_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_insights_type ON analytics_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_analytics_insights_status ON analytics_insights(status);
CREATE INDEX IF NOT EXISTS idx_analytics_insights_confidence ON analytics_insights(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_insights_generated_at ON analytics_insights(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_insights_org_status ON analytics_insights(organisation_id, status);

-- RLS Policy for analytics_insights
ALTER TABLE analytics_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY analytics_insights_org_isolation ON analytics_insights
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- Trigger for updated_at
CREATE TRIGGER analytics_insights_updated_at
  BEFORE UPDATE ON analytics_insights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 3. CUSTOM REPORTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS custom_reports (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  report_name VARCHAR(255) NOT NULL,
  description TEXT,
  report_type VARCHAR(100) NOT NULL, -- 'financial', 'operational', 'sales', 'custom'
  metrics JSONB NOT NULL, -- Array of metric configurations
  filters JSONB DEFAULT '{}', -- Report filters
  grouping JSONB DEFAULT '{}', -- Grouping configuration
  chart_type VARCHAR(50), -- 'line', 'bar', 'pie', 'table', 'heatmap'
  date_range JSONB DEFAULT '{"start": null, "end": null}',
  refresh_interval VARCHAR(50), -- 'realtime', 'hourly', 'daily', 'weekly', 'manual'
  is_public BOOLEAN DEFAULT FALSE,
  is_scheduled BOOLEAN DEFAULT FALSE,
  schedule_cron VARCHAR(100),
  recipients JSONB DEFAULT '[]', -- Email recipients for scheduled reports
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'archived', 'draft'
  last_generated_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for custom_reports
CREATE INDEX IF NOT EXISTS idx_custom_reports_org_id ON custom_reports(organisation_id);
CREATE INDEX IF NOT EXISTS idx_custom_reports_user_id ON custom_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_reports_type ON custom_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_custom_reports_status ON custom_reports(status);
CREATE INDEX IF NOT EXISTS idx_custom_reports_is_public ON custom_reports(is_public);
CREATE INDEX IF NOT EXISTS idx_custom_reports_org_user ON custom_reports(organisation_id, user_id);

-- RLS Policy for custom_reports
ALTER TABLE custom_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_reports_org_isolation ON custom_reports
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- Trigger for updated_at
CREATE TRIGGER custom_reports_updated_at
  BEFORE UPDATE ON custom_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 4. ANALYTICS ALERTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS analytics_alerts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  alert_name VARCHAR(255) NOT NULL,
  description TEXT,
  alert_type VARCHAR(100) NOT NULL, -- 'threshold', 'anomaly', 'trend', 'custom'
  metric_name VARCHAR(255) NOT NULL,
  condition VARCHAR(50) NOT NULL, -- 'greater_than', 'less_than', 'equals', 'between'
  threshold_value NUMERIC,
  threshold_upper NUMERIC,
  threshold_lower NUMERIC,
  severity VARCHAR(50) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
  is_enabled BOOLEAN DEFAULT TRUE,
  notification_channels JSONB DEFAULT '["email"]', -- 'email', 'slack', 'webhook', 'in_app'
  recipients JSONB DEFAULT '[]',
  webhook_url VARCHAR(500),
  last_triggered_at TIMESTAMP WITH TIME ZONE,
  trigger_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for analytics_alerts
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_org_id ON analytics_alerts(organisation_id);
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_user_id ON analytics_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_type ON analytics_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_enabled ON analytics_alerts(is_enabled);
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_metric ON analytics_alerts(metric_name);
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_org_enabled ON analytics_alerts(organisation_id, is_enabled);

-- RLS Policy for analytics_alerts
ALTER TABLE analytics_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY analytics_alerts_org_isolation ON analytics_alerts
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- Trigger for updated_at
CREATE TRIGGER analytics_alerts_updated_at
  BEFORE UPDATE ON analytics_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 5. METRIC SNAPSHOTS TABLE (for historical trending)
-- ============================================================================
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  metric_name VARCHAR(255) NOT NULL,
  snapshot_data JSONB NOT NULL, -- Contains aggregated metrics
  aggregation_type VARCHAR(50) NOT NULL, -- 'hourly', 'daily', 'weekly', 'monthly'
  snapshot_date DATE NOT NULL,
  snapshot_time TIMESTAMP WITH TIME ZONE NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for metric_snapshots
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_org_id ON metric_snapshots(organisation_id);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_metric_name ON metric_snapshots(metric_name);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_date ON metric_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_time ON metric_snapshots(snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_org_metric_date ON metric_snapshots(organisation_id, metric_name, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_aggregation ON metric_snapshots(aggregation_type);

-- RLS Policy for metric_snapshots
ALTER TABLE metric_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY metric_snapshots_org_isolation ON metric_snapshots
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- ============================================================================
-- 6. INSIGHT INTERACTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS insight_interactions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  insight_id BIGINT NOT NULL REFERENCES analytics_insights(id) ON DELETE CASCADE,
  interaction_type VARCHAR(100) NOT NULL, -- 'viewed', 'clicked', 'dismissed', 'acted_on', 'shared'
  action_taken VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for insight_interactions
CREATE INDEX IF NOT EXISTS idx_insight_interactions_org_id ON insight_interactions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_insight_interactions_user_id ON insight_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_insight_interactions_insight_id ON insight_interactions(insight_id);
CREATE INDEX IF NOT EXISTS idx_insight_interactions_type ON insight_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_insight_interactions_created_at ON insight_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insight_interactions_org_user ON insight_interactions(organisation_id, user_id);

-- RLS Policy for insight_interactions
ALTER TABLE insight_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY insight_interactions_org_isolation ON insight_interactions
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE real_time_metrics IS 'Stores real-time metric data for live dashboards and monitoring';
COMMENT ON TABLE analytics_insights IS 'Stores AI-generated insights, trends, anomalies, and predictions';
COMMENT ON TABLE custom_reports IS 'Stores user-defined custom report configurations';
COMMENT ON TABLE analytics_alerts IS 'Stores alert configurations for metric thresholds and anomalies';
COMMENT ON TABLE metric_snapshots IS 'Stores historical metric snapshots for trending and analysis';
COMMENT ON TABLE insight_interactions IS 'Tracks user interactions with insights for analytics';

-- ============================================================================
-- MIGRATION METADATA
-- ============================================================================
-- This migration creates the foundation for Phase 7 Batch 7.3: Real-time Analytics
-- It includes tables for:
-- 1. Real-time metric collection and storage
-- 2. AI-powered insights and predictions
-- 3. Custom report builder
-- 4. Alert management system
-- 5. Historical metric snapshots for trending
-- 6. Insight interaction tracking
--
-- All tables include:
-- - Multi-tenant RLS policies
-- - Comprehensive indexes for performance
-- - JSONB fields for flexible metadata
-- - Proper foreign key constraints
-- - Automatic timestamp management
