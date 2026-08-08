-- Migration: Create help chat tables for Phase 3.3
-- Date: 2026-08-06
-- Purpose: Enable AI chatbot functionality with conversation history and context

-- Create help_chat_sessions table to store conversation sessions
CREATE TABLE IF NOT EXISTS help_chat_sessions (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  session_id VARCHAR(100) NOT NULL UNIQUE,
  language VARCHAR(10) NOT NULL DEFAULT 'fr',
  title VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create help_chat_messages table to store individual messages
CREATE TABLE IF NOT EXISTS help_chat_messages (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  session_id VARCHAR(100) NOT NULL REFERENCES help_chat_sessions(session_id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tokens_used INTEGER,
  model VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create help_chat_context table to store suggested articles and context
CREATE TABLE IF NOT EXISTS help_chat_context (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  session_id VARCHAR(100) NOT NULL REFERENCES help_chat_sessions(session_id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES help_chat_messages(id) ON DELETE CASCADE,
  article_id VARCHAR(100),
  article_title VARCHAR(255),
  relevance_score REAL,
  suggested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_help_chat_sessions_org ON help_chat_sessions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_help_chat_sessions_user ON help_chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_help_chat_sessions_id ON help_chat_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_help_chat_sessions_created ON help_chat_sessions(created_at);

CREATE INDEX IF NOT EXISTS idx_help_chat_messages_org ON help_chat_messages(organisation_id);
CREATE INDEX IF NOT EXISTS idx_help_chat_messages_session ON help_chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_help_chat_messages_user ON help_chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_help_chat_messages_created ON help_chat_messages(created_at);

CREATE INDEX IF NOT EXISTS idx_help_chat_context_org ON help_chat_context(organisation_id);
CREATE INDEX IF NOT EXISTS idx_help_chat_context_session ON help_chat_context(session_id);
CREATE INDEX IF NOT EXISTS idx_help_chat_context_article ON help_chat_context(article_id);

-- Enable RLS (Row Level Security)
ALTER TABLE help_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_chat_context ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their organization's chat data
CREATE POLICY help_chat_sessions_org_isolation ON help_chat_sessions
  USING (organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER));

CREATE POLICY help_chat_messages_org_isolation ON help_chat_messages
  USING (organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER));

CREATE POLICY help_chat_context_org_isolation ON help_chat_context
  USING (organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER));

-- Create function to update session last_activity_at
CREATE OR REPLACE FUNCTION update_help_chat_session_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE help_chat_sessions
  SET last_activity_at = CURRENT_TIMESTAMP
  WHERE session_id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update session activity on new message
DROP TRIGGER IF EXISTS help_chat_message_activity_update ON help_chat_messages;
CREATE TRIGGER help_chat_message_activity_update
AFTER INSERT ON help_chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_help_chat_session_activity();

-- Create view for active chat sessions
CREATE OR REPLACE VIEW help_chat_active_sessions AS
SELECT
  hcs.id,
  hcs.organisation_id,
  hcs.user_id,
  hcs.session_id,
  hcs.language,
  hcs.title,
  hcs.created_at,
  hcs.last_activity_at,
  COUNT(hcm.id) as message_count,
  MAX(hcm.created_at) as last_message_at
FROM help_chat_sessions hcs
LEFT JOIN help_chat_messages hcm ON hcs.session_id = hcm.session_id
WHERE hcs.organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER)
GROUP BY hcs.id, hcs.organisation_id, hcs.user_id, hcs.session_id, hcs.language, hcs.title, hcs.created_at, hcs.last_activity_at;

-- Create view for chat statistics
CREATE OR REPLACE VIEW help_chat_statistics AS
SELECT
  organisation_id,
  COUNT(DISTINCT session_id) as total_sessions,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_messages,
  AVG(tokens_used) as avg_tokens_per_message,
  MAX(created_at) as last_message_at
FROM help_chat_messages
WHERE organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER)
GROUP BY organisation_id;

-- Create function to cleanup old chat sessions (retention policy)
CREATE OR REPLACE FUNCTION cleanup_old_chat_sessions(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM help_chat_sessions
  WHERE organisation_id = CAST(current_setting('app.current_organisation_id') AS INTEGER)
    AND last_activity_at < CURRENT_TIMESTAMP - INTERVAL '1 day' * retention_days;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add comments to tables
COMMENT ON TABLE help_chat_sessions IS 'Stores AI chatbot conversation sessions';
COMMENT ON TABLE help_chat_messages IS 'Stores individual messages in chat conversations';
COMMENT ON TABLE help_chat_context IS 'Stores suggested articles and context for chat messages';

COMMENT ON COLUMN help_chat_sessions.session_id IS 'Unique session identifier (UUID)';
COMMENT ON COLUMN help_chat_sessions.language IS 'Language of the conversation (fr, en, es, de, pt, it)';
COMMENT ON COLUMN help_chat_messages.role IS 'Message role: user or assistant';
COMMENT ON COLUMN help_chat_messages.tokens_used IS 'OpenAI tokens used for this message';
COMMENT ON COLUMN help_chat_context.relevance_score IS 'Relevance score for suggested article (0-1)';
