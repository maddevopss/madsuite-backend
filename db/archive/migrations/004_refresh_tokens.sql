-- ============================================================
-- MADSuite / TimeMonitoring
-- 004_refresh_tokens.sql
-- Refresh tokens persistés et rotation
-- ============================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by_token_id INTEGER REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  ip_address VARCHAR(255),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
ON refresh_tokens(utilisateur_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id
ON refresh_tokens(session_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
ON refresh_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active
ON refresh_tokens(session_id, revoked_at, expires_at);