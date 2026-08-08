-- Migration: Create help_feedback table for Phase 3.2
-- Date: 2026-08-06
-- Purpose: Collect user feedback (ratings and comments) on help articles

-- Create help_feedback table
CREATE TABLE IF NOT EXISTS help_feedback (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  article_id VARCHAR(100) NOT NULL,
  user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating IN (1, -1)), -- 1 for 👍, -1 for 👎
  comment TEXT,
  language VARCHAR(10) DEFAULT 'fr',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_help_feedback_org ON help_feedback(organisation_id);
CREATE INDEX IF NOT EXISTS idx_help_feedback_article ON help_feedback(article_id);
CREATE INDEX IF NOT EXISTS idx_help_feedback_user ON help_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_help_feedback_rating ON help_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_help_feedback_created ON help_feedback(created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE help_feedback ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see feedback for their organization
CREATE POLICY help_feedback_org_isolation ON help_feedback
  USING (organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER));

-- RLS Policy: Users can insert their own feedback
CREATE POLICY help_feedback_insert ON help_feedback
  FOR INSERT
  WITH CHECK (organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER));

-- RLS Policy: Users can select feedback for their organization
CREATE POLICY help_feedback_select ON help_feedback
  FOR SELECT
  USING (organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER));

-- Create view for feedback summary
CREATE OR REPLACE VIEW help_feedback_summary AS
SELECT
  organisation_id,
  article_id,
  language,
  COUNT(*) as total_feedback,
  SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as positive_count,
  SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as negative_count,
  ROUND(
    (SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)::NUMERIC / COUNT(*)) * 100,
    2
  ) as positive_percentage,
  MAX(created_at) as last_feedback_at
FROM help_feedback
GROUP BY organisation_id, article_id, language;

-- Create view for articles needing improvement
CREATE OR REPLACE VIEW help_articles_needing_improvement AS
SELECT
  organisation_id,
  article_id,
  language,
  COUNT(*) as total_feedback,
  SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as negative_count,
  ROUND(
    (SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END)::NUMERIC / COUNT(*)) * 100,
    2
  ) as negative_percentage
FROM help_feedback
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY organisation_id, article_id, language
HAVING SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) > 0
ORDER BY negative_count DESC;

-- Create view for recent feedback with comments
CREATE OR REPLACE VIEW help_feedback_with_comments AS
SELECT
  id,
  organisation_id,
  article_id,
  user_id,
  rating,
  comment,
  language,
  created_at
FROM help_feedback
WHERE comment IS NOT NULL AND comment != ''
ORDER BY created_at DESC;

-- Add comment to table
COMMENT ON TABLE help_feedback IS 'Stores user feedback (ratings and comments) on help articles for improvement tracking';
COMMENT ON COLUMN help_feedback.article_id IS 'Article identifier (e.g., onboarding, dashboard, invoices)';
COMMENT ON COLUMN help_feedback.rating IS 'User rating: 1 for helpful (👍), -1 for not helpful (👎)';
COMMENT ON COLUMN help_feedback.comment IS 'Optional user comment explaining their feedback';
COMMENT ON COLUMN help_feedback.language IS 'Language of the article (fr, en, es, de, pt, it)';
