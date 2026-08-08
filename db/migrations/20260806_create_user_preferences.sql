-- 20260806_create_user_preferences.sql
-- Phase 7 Batch 7.1: Advanced Personalization
-- User preferences, behavior tracking, and personalization settings tables

-- User Preferences Table
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  
  -- Theme and UI preferences
  theme VARCHAR(50) DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'auto')),
  language VARCHAR(10) DEFAULT 'en' CHECK (language IN ('en', 'fr', 'es', 'de')),
  timezone VARCHAR(100) DEFAULT 'UTC',
  
  -- Notification preferences
  notifications_enabled BOOLEAN DEFAULT true,
  email_notifications BOOLEAN DEFAULT true,
  push_notifications BOOLEAN DEFAULT true,
  notification_frequency VARCHAR(50) DEFAULT 'immediate' CHECK (notification_frequency IN ('immediate', 'daily', 'weekly', 'never')),
  
  -- UI customization
  sidebar_collapsed BOOLEAN DEFAULT false,
  compact_mode BOOLEAN DEFAULT false,
  animations_enabled BOOLEAN DEFAULT true,
  accessibility_mode BOOLEAN DEFAULT false,
  
  -- Dashboard preferences
  dashboard_layout VARCHAR(50) DEFAULT 'grid' CHECK (dashboard_layout IN ('grid', 'list', 'compact')),
  default_view VARCHAR(100) DEFAULT 'dashboard',
  items_per_page INTEGER DEFAULT 20 CHECK (items_per_page > 0 AND items_per_page <= 100),
  
  -- Personalization settings
  personalization_enabled BOOLEAN DEFAULT true,
  recommendations_enabled BOOLEAN DEFAULT true,
  learning_enabled BOOLEAN DEFAULT true,
  
  -- Additional preferences as JSONB
  custom_settings JSONB DEFAULT '{}'::jsonb,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- RLS Multi-tenant security
  UNIQUE(organisation_id, user_id)
);

-- Enable RLS on user_preferences
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own preferences
CREATE POLICY user_preferences_rls ON user_preferences
  FOR ALL
  USING (
    organisation_id = current_setting('app.current_organisation_id')::uuid
    AND user_id = current_setting('app.current_user_id')::uuid
  );

-- Behavior Tracking Table
CREATE TABLE IF NOT EXISTS user_behavior_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  
  -- Behavior event
  event_type VARCHAR(100) NOT NULL,
  event_name VARCHAR(255) NOT NULL,
  event_category VARCHAR(100),
  
  -- Context
  page_url VARCHAR(500),
  component_name VARCHAR(255),
  action_type VARCHAR(100),
  
  -- Metrics
  duration_ms INTEGER,
  interaction_count INTEGER DEFAULT 1,
  success BOOLEAN DEFAULT true,
  
  -- Additional data
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- RLS Multi-tenant security
  CONSTRAINT behaviour_tracking_org_user CHECK (organisation_id IS NOT NULL AND user_id IS NOT NULL)
);

-- Enable RLS on user_behavior_tracking
ALTER TABLE user_behavior_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own behavior
CREATE POLICY user_behavior_tracking_rls ON user_behavior_tracking
  FOR ALL
  USING (
    organisation_id = current_setting('app.current_organisation_id')::uuid
    AND user_id = current_setting('app.current_user_id')::uuid
  );

-- Personalization Settings Table
CREATE TABLE IF NOT EXISTS personalization_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  
  -- Personalization type
  setting_type VARCHAR(100) NOT NULL,
  setting_key VARCHAR(255) NOT NULL,
  setting_value JSONB NOT NULL,
  
  -- Metadata
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- RLS Multi-tenant security
  UNIQUE(organisation_id, user_id, setting_type, setting_key)
);

-- Enable RLS on personalization_settings
ALTER TABLE personalization_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own settings
CREATE POLICY personalization_settings_rls ON personalization_settings
  FOR ALL
  USING (
    organisation_id = current_setting('app.current_organisation_id')::uuid
    AND user_id = current_setting('app.current_user_id')::uuid
  );

-- User Recommendations Table
CREATE TABLE IF NOT EXISTS user_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  
  -- Recommendation details
  recommendation_type VARCHAR(100) NOT NULL,
  recommendation_title VARCHAR(255) NOT NULL,
  recommendation_description TEXT,
  
  -- Scoring
  confidence_score DECIMAL(3, 2) DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  relevance_score DECIMAL(3, 2) DEFAULT 0.5 CHECK (relevance_score >= 0 AND relevance_score <= 1),
  
  -- Status
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'viewed', 'accepted', 'rejected', 'expired')),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  action_url VARCHAR(500),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  viewed_at TIMESTAMP WITH TIME ZONE,
  acted_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  
  -- RLS Multi-tenant security
  CONSTRAINT recommendations_org_user CHECK (organisation_id IS NOT NULL AND user_id IS NOT NULL)
);

-- Enable RLS on user_recommendations
ALTER TABLE user_recommendations ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own recommendations
CREATE POLICY user_recommendations_rls ON user_recommendations
  FOR ALL
  USING (
    organisation_id = current_setting('app.current_organisation_id')::uuid
    AND user_id = current_setting('app.current_user_id')::uuid
  );

-- Adaptive UI State Table
CREATE TABLE IF NOT EXISTS adaptive_ui_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  
  -- UI state
  state_key VARCHAR(255) NOT NULL,
  state_value JSONB NOT NULL,
  
  -- Context
  page_context VARCHAR(255),
  device_type VARCHAR(50),
  screen_size VARCHAR(50),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- RLS Multi-tenant security
  UNIQUE(organisation_id, user_id, state_key)
);

-- Enable RLS on adaptive_ui_state
ALTER TABLE adaptive_ui_state ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own UI state
CREATE POLICY adaptive_ui_state_rls ON adaptive_ui_state
  FOR ALL
  USING (
    organisation_id = current_setting('app.current_organisation_id')::uuid
    AND user_id = current_setting('app.current_user_id')::uuid
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_preferences_org_user ON user_preferences(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at ON user_preferences(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_behavior_tracking_org_user ON user_behavior_tracking(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_behavior_tracking_created_at ON user_behavior_tracking(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_behavior_tracking_event_type ON user_behavior_tracking(event_type);

CREATE INDEX IF NOT EXISTS idx_personalization_settings_org_user ON personalization_settings(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_personalization_settings_type ON personalization_settings(setting_type);

CREATE INDEX IF NOT EXISTS idx_user_recommendations_org_user ON user_recommendations(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_recommendations_status ON user_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_user_recommendations_created_at ON user_recommendations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_adaptive_ui_state_org_user ON adaptive_ui_state(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_adaptive_ui_state_updated_at ON adaptive_ui_state(updated_at DESC);

-- Create updated_at trigger for user_preferences
CREATE OR REPLACE FUNCTION update_user_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_preferences_updated_at_trigger
BEFORE UPDATE ON user_preferences
FOR EACH ROW
EXECUTE FUNCTION update_user_preferences_updated_at();

-- Create updated_at trigger for personalization_settings
CREATE OR REPLACE FUNCTION update_personalization_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER personalization_settings_updated_at_trigger
BEFORE UPDATE ON personalization_settings
FOR EACH ROW
EXECUTE FUNCTION update_personalization_settings_updated_at();

-- Create updated_at trigger for adaptive_ui_state
CREATE OR REPLACE FUNCTION update_adaptive_ui_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER adaptive_ui_state_updated_at_trigger
BEFORE UPDATE ON adaptive_ui_state
FOR EACH ROW
EXECUTE FUNCTION update_adaptive_ui_state_updated_at();
