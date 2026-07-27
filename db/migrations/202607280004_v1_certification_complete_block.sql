CREATE TABLE IF NOT EXISTS v1_certifications (
  id bigserial PRIMARY KEY,
  release_version text NOT NULL UNIQUE,
  source_commit text NOT NULL,
  architecture_verified boolean NOT NULL DEFAULT false,
  security_verified boolean NOT NULL DEFAULT false,
  data_integrity_verified boolean NOT NULL DEFAULT false,
  operations_verified boolean NOT NULL DEFAULT false,
  documentation_verified boolean NOT NULL DEFAULT false,
  compliance_verified boolean NOT NULL DEFAULT false,
  release_candidate_verified boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','certified','rejected','revoked')),
  approved_by bigint,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);