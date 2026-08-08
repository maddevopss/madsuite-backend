-- 20260806_create_onboarding.sql
-- Phase 7 Batch 7.2: Enhanced User Experience
-- Onboarding, tutorials, help system, and feature discovery tables

-- Onboarding Progress Table
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  
  -- Onboarding flow
  flow_type VARCHAR(100) NOT NULL,
  current_step INTEGER DEFAULT 1,
  total_steps INTEGER DEFAULT 5,
  
  -- Status
  status VARCHAR(50) DEFAULT 'in_progress' CHECK (status IN ('not_started', 'in_progress', 'completed', 'skipped')),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- RLS Multi-tenant security
  UNIQUE(organisation_id, user_id, flow_type)
);

-- Enable RLS on onboarding_progress
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own onboarding progress
CREATE POLICY onboarding_progress_rls ON onboarding_progress
  FOR ALL
  USING (
    organisation_id = current_setting('app.current_organisation_id')::INTEGER
    AND user_id = current_setting('app.current_user_id')::INTEGER
  );

-- Tutorial Completion Table
CREATE TABLE IF NOT EXISTS tutorial_completion (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  
  -- Tutorial details
  tutorial_id VARCHAR(255) NOT NULL,
  tutorial_title VARCHAR(255) NOT NULL,
  tutorial_category VARCHAR(100),
  
  -- Completion status
  status VARCHAR(50) DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'skipped')),
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- RLS Multi-tenant security
  UNIQUE(organisation_id, user_id, tutorial_id)
);

-- Enable RLS on tutorial_completion
ALTER TABLE tutorial_completion ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own tutorial completion
CREATE POLICY tutorial_completion_rls ON tutorial_completion
  FOR ALL
  USING (
    organisation_id = current_setting('app.current_organisation_id')::INTEGER
    AND user_id = current_setting('app.current_user_id')::INTEGER
  );

-- Help Articles Table
CREATE TABLE IF NOT EXISTS help_articles (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  
  -- Article details
  article_slug VARCHAR(255) NOT NULL,
  article_title VARCHAR(255) NOT NULL,
  article_content TEXT NOT NULL,
  article_category VARCHAR(100),
  
  -- Metadata
  keywords VARCHAR(500),
  related_articles UUID[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Status
  published BOOLEAN DEFAULT true,
  featured BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- RLS Multi-tenant security
  UNIQUE(organisation_id, article_slug)
);

-- Enable RLS on help_articles
ALTER TABLE help_articles ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can see published help articles
CREATE POLICY help_articles_rls ON help_articles
  FOR SELECT
  USING (
    organisation_id = current_setting('app.current_organisation_id')::INTEGER
    AND published = true
  );

-- Feature Discovery Table
CREATE TABLE IF NOT EXISTS feature_discovery (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  
  -- Feature details
  feature_id VARCHAR(255) NOT NULL,
  feature_name VARCHAR(255) NOT NULL,
  feature_description TEXT,
  feature_category VARCHAR(100),
  
  -- Discovery status
  status VARCHAR(50) DEFAULT 'new' CHECK (status IN ('new', 'discovered', 'dismissed', 'learned')),
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  discovered_at TIMESTAMP WITH TIME ZONE,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- RLS Multi-tenant security
  UNIQUE(organisation_id, user_id, feature_id)
);

-- Enable RLS on feature_discovery
ALTER TABLE feature_discovery ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own feature discovery
CREATE POLICY feature_discovery_rls ON feature_discovery
  FOR ALL
  USING (
    organisation_id = current_setting('app.current_organisation_id')::INTEGER
    AND user_id = current_setting('app.current_user_id')::INTEGER
  );

-- Contextual Help Interactions Table
CREATE TABLE IF NOT EXISTS contextual_help_interactions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  
  -- Help context
  help_topic VARCHAR(255) NOT NULL,
  help_type VARCHAR(100),
  page_context VARCHAR(255),
  
  -- Interaction details
  interaction_type VARCHAR(100),
  helpful BOOLEAN,
  feedback TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- RLS Multi-tenant security
  CONSTRAINT contextual_help_org_user CHECK (organisation_id IS NOT NULL AND user_id IS NOT NULL)
);

-- Enable RLS on contextual_help_interactions
ALTER TABLE contextual_help_interactions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own help interactions
CREATE POLICY contextual_help_interactions_rls ON contextual_help_interactions
  FOR ALL
  USING (
    organisation_id = current_setting('app.current_organisation_id')::INTEGER
    AND user_id = current_setting('app.current_user_id')::INTEGER
  );

-- Onboarding Steps Configuration Table
CREATE TABLE IF NOT EXISTS onboarding_steps (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  
  -- Step details
  flow_type VARCHAR(100) NOT NULL,
  step_number INTEGER NOT NULL,
  step_title VARCHAR(255) NOT NULL,
  step_description TEXT,
  step_content JSONB NOT NULL,
  
  -- Configuration
  required BOOLEAN DEFAULT true,
  skippable BOOLEAN DEFAULT true,
  duration_seconds INTEGER,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- RLS Multi-tenant security
  UNIQUE(organisation_id, flow_type, step_number)
);

-- Enable RLS on onboarding_steps
ALTER TABLE onboarding_steps ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can see onboarding steps for their organization
CREATE POLICY onboarding_steps_rls ON onboarding_steps
  FOR SELECT
  USING (
    organisation_id = current_setting('app.current_organisation_id')::INTEGER
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_org_user ON onboarding_progress(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_status ON onboarding_progress(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_updated_at ON onboarding_progress(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tutorial_completion_org_user ON tutorial_completion(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_tutorial_completion_status ON tutorial_completion(status);
CREATE INDEX IF NOT EXISTS idx_tutorial_completion_category ON tutorial_completion(tutorial_category);

CREATE INDEX IF NOT EXISTS idx_help_articles_org ON help_articles(organisation_id);
CREATE INDEX IF NOT EXISTS idx_help_articles_category ON help_articles(article_category);
CREATE INDEX IF NOT EXISTS idx_help_articles_published ON help_articles(published);
CREATE INDEX IF NOT EXISTS idx_help_articles_featured ON help_articles(featured);

CREATE INDEX IF NOT EXISTS idx_feature_discovery_org_user ON feature_discovery(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_feature_discovery_status ON feature_discovery(status);
CREATE INDEX IF NOT EXISTS idx_feature_discovery_created_at ON feature_discovery(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contextual_help_org_user ON contextual_help_interactions(organisation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_contextual_help_topic ON contextual_help_interactions(help_topic);
CREATE INDEX IF NOT EXISTS idx_contextual_help_created_at ON contextual_help_interactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_steps_org_flow ON onboarding_steps(organisation_id, flow_type);

-- Create updated_at trigger for onboarding_progress
CREATE OR REPLACE FUNCTION update_onboarding_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onboarding_progress_updated_at_trigger
BEFORE UPDATE ON onboarding_progress
FOR EACH ROW
EXECUTE FUNCTION update_onboarding_progress_updated_at();

-- Create updated_at trigger for tutorial_completion
CREATE OR REPLACE FUNCTION update_tutorial_completion_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tutorial_completion_updated_at_trigger
BEFORE UPDATE ON tutorial_completion
FOR EACH ROW
EXECUTE FUNCTION update_tutorial_completion_updated_at();

-- Create updated_at trigger for help_articles
CREATE OR REPLACE FUNCTION update_help_articles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER help_articles_updated_at_trigger
BEFORE UPDATE ON help_articles
FOR EACH ROW
EXECUTE FUNCTION update_help_articles_updated_at();

-- Create updated_at trigger for feature_discovery
CREATE OR REPLACE FUNCTION update_feature_discovery_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER feature_discovery_updated_at_trigger
BEFORE UPDATE ON feature_discovery
FOR EACH ROW
EXECUTE FUNCTION update_feature_discovery_updated_at();

-- Create updated_at trigger for onboarding_steps
CREATE OR REPLACE FUNCTION update_onboarding_steps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onboarding_steps_updated_at_trigger
BEFORE UPDATE ON onboarding_steps
FOR EACH ROW
EXECUTE FUNCTION update_onboarding_steps_updated_at();
