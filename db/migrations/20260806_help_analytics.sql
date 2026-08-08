-- Migration: Create help_analytics table for Phase 3.1
-- Date: 2026-08-06
-- Purpose: Track article views, search queries, and user engagement metrics

-- Create help_analytics table
CREATE TABLE IF NOT EXISTS help_analytics (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  article_id VARCHAR(100) NOT NULL,
  user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  view_count INTEGER DEFAULT 1,
  last_viewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  search_query VARCHAR(255),
  language VARCHAR(10) DEFAULT 'fr',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_help_analytics_org ON help_analytics(organisation_id);
CREATE INDEX IF NOT EXISTS idx_help_analytics_article ON help_analytics(article_id);
CREATE INDEX IF NOT EXISTS idx_help_analytics_user ON help_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_help_analytics_created ON help_analytics(created_at);
CREATE INDEX IF NOT EXISTS idx_help_analytics_search ON help_analytics(search_query);

-- Enable RLS (Row Level Security)
ALTER TABLE help_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see analytics for their organization
CREATE POLICY help_analytics_org_isolation ON help_analytics
  USING (organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER));

-- RLS Policy: Only admins can insert analytics
CREATE POLICY help_analytics_insert ON help_analytics
  FOR INSERT
  WITH CHECK (organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER));

-- RLS Policy: Only admins can select analytics
CREATE POLICY help_analytics_select ON help_analytics
  FOR SELECT
  USING (organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER));

-- Create view for analytics summary
CREATE OR REPLACE VIEW help_analytics_summary AS
SELECT
  organisation_id,
  article_id,
  language,
  COUNT(*) as total_views,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(DISTINCT search_query) as unique_searches,
  MAX(last_viewed) as last_viewed_at,
  DATE(MAX(created_at)) as last_tracked_date
FROM help_analytics
GROUP BY organisation_id, article_id, language;

-- Create view for top articles
CREATE OR REPLACE VIEW help_top_articles AS
SELECT
  organisation_id,
  article_id,
  language,
  COUNT(*) as view_count,
  COUNT(DISTINCT user_id) as unique_users,
  MAX(last_viewed) as last_viewed_at
FROM help_analytics
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY organisation_id, article_id, language
ORDER BY view_count DESC;

-- Create view for search queries
CREATE OR REPLACE VIEW help_search_queries AS
SELECT
  organisation_id,
  search_query,
  language,
  COUNT(*) as query_count,
  COUNT(DISTINCT user_id) as unique_users,
  MAX(created_at) as last_searched_at
FROM help_analytics
WHERE search_query IS NOT NULL
GROUP BY organisation_id, search_query, language
ORDER BY query_count DESC;

-- Add comment to table
COMMENT ON TABLE help_analytics IS 'Tracks article views, search queries, and user engagement for Help Center analytics';
COMMENT ON COLUMN help_analytics.article_id IS 'Article identifier (e.g., onboarding, dashboard, invoices)';
COMMENT ON COLUMN help_analytics.view_count IS 'Number of times this article was viewed by this user';
COMMENT ON COLUMN help_analytics.search_query IS 'Search query used to find this article (if applicable)';
COMMENT ON COLUMN help_analytics.language IS 'Language of the article (fr, en, es, de, pt, it)';
