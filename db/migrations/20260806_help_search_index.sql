-- Migration: Create help search index for Phase 3.6
-- Date: 2026-08-06
-- Purpose: Enable full-text search on help articles

-- Create help_search_index table to store searchable content
CREATE TABLE IF NOT EXISTS help_search_index (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  article_id VARCHAR(100) NOT NULL,
  language VARCHAR(10) NOT NULL DEFAULT 'fr',
  title VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT,
  search_vector tsvector,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organisation_id, article_id, language)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_help_search_org ON help_search_index(organisation_id);
CREATE INDEX IF NOT EXISTS idx_help_search_article ON help_search_index(article_id);
CREATE INDEX IF NOT EXISTS idx_help_search_language ON help_search_index(language);
CREATE INDEX IF NOT EXISTS idx_help_search_vector ON help_search_index USING GIN(search_vector);

-- Enable RLS (Row Level Security)
ALTER TABLE help_search_index ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only search articles for their organization
CREATE POLICY help_search_org_isolation ON help_search_index
  USING (organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER));

-- Create function to update search vector
CREATE OR REPLACE FUNCTION update_help_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('french', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update search vector
DROP TRIGGER IF EXISTS help_search_vector_update ON help_search_index;
CREATE TRIGGER help_search_vector_update
BEFORE INSERT OR UPDATE ON help_search_index
FOR EACH ROW
EXECUTE FUNCTION update_help_search_vector();

-- Create view for search suggestions
CREATE OR REPLACE VIEW help_search_suggestions AS
SELECT DISTINCT
  organisation_id,
  title as suggestion,
  language,
  'article' as type
FROM help_search_index
WHERE organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER)
ORDER BY title;

-- Create function for full-text search
CREATE OR REPLACE FUNCTION search_help_articles(
  p_organisation_id INTEGER,
  p_search_query TEXT,
  p_language VARCHAR(10) DEFAULT 'fr',
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  article_id VARCHAR(100),
  title VARCHAR(255),
  description TEXT,
  language VARCHAR(10),
  relevance REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    hsi.article_id,
    hsi.title,
    hsi.description,
    hsi.language,
    ts_rank(hsi.search_vector, plainto_tsquery('french', p_search_query))::REAL as relevance
  FROM help_search_index hsi
  WHERE hsi.organisation_id = p_organisation_id
    AND hsi.language = p_language
    AND hsi.search_vector @@ plainto_tsquery('french', p_search_query)
  ORDER BY relevance DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Create function for search suggestions
CREATE OR REPLACE FUNCTION get_help_search_suggestions(
  p_organisation_id INTEGER,
  p_partial_query TEXT,
  p_language VARCHAR(10) DEFAULT 'fr',
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  suggestion VARCHAR(255),
  type VARCHAR(50)
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    hsi.title as suggestion,
    'article'::VARCHAR(50) as type
  FROM help_search_index hsi
  WHERE hsi.organisation_id = p_organisation_id
    AND hsi.language = p_language
    AND hsi.title ILIKE '%' || p_partial_query || '%'
  ORDER BY hsi.title
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Add comment to table
COMMENT ON TABLE help_search_index IS 'Full-text search index for help articles with tsvector support';
COMMENT ON COLUMN help_search_index.article_id IS 'Article identifier (e.g., onboarding, dashboard, invoices)';
COMMENT ON COLUMN help_search_index.search_vector IS 'PostgreSQL tsvector for full-text search';
COMMENT ON COLUMN help_search_index.language IS 'Language of the article (fr, en, es, de, pt, it)';
