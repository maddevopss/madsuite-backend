CREATE TABLE IF NOT EXISTS resilience_events (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  owner_user_id BIGINT NOT NULL,
  justification TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  proof_reference TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS resilience_crisis_cells (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  event_id BIGINT NOT NULL REFERENCES resilience_events(id),
  lead_user_id BIGINT NOT NULL,
  mandate TEXT NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ,
  proof_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resilience_decisions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  event_id BIGINT NOT NULL REFERENCES resilience_events(id),
  author_user_id BIGINT NOT NULL,
  decision TEXT NOT NULL,
  justification TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proof_reference TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS resilience_communications (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  event_id BIGINT NOT NULL REFERENCES resilience_events(id),
  author_user_id BIGINT NOT NULL,
  approver_user_id BIGINT NOT NULL,
  channel TEXT NOT NULL,
  audience TEXT NOT NULL,
  message TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proof_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS resilience_timeline (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  event_id BIGINT NOT NULL REFERENCES resilience_events(id),
  entry_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resilience_exercises (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  scenario TEXT NOT NULL,
  coordinator_user_id BIGINT NOT NULL,
  performed_at TIMESTAMPTZ NOT NULL,
  report_reference TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resilience_lessons (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  source_type TEXT NOT NULL,
  source_id BIGINT NOT NULL,
  lesson TEXT NOT NULL,
  impact TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  proof_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resilience_improvements (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  lesson_id BIGINT REFERENCES resilience_lessons(id),
  title TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  closure_proof_reference TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resilience_events_org_status ON resilience_events (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_resilience_timeline_event ON resilience_timeline (organisation_id, event_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_resilience_improvements_org_status ON resilience_improvements (organisation_id, status);