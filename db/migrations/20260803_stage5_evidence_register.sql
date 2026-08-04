-- Migration: Stage 5 Evidence Register
-- Immutable audit trail and compliance tracking for all Stage 5 operations

-- Table for evidence entries (immutable audit trail)
CREATE TABLE IF NOT EXISTS evidence_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Entry classification
  entry_type VARCHAR(100) NOT NULL,        -- 'operation', 'state_change', 'backup', 'restore', 'deletion', 'access', 'error'
  component_name VARCHAR(100) NOT NULL,   -- Which Stage 5 component
  resource_type VARCHAR(100),             -- 'job', 'event', 'quarantine_item', 'retry_attempt', etc.
  resource_id VARCHAR(255),

  -- Action details
  action VARCHAR(100),                    -- 'CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'BACKUP', etc.
  status VARCHAR(50),                     -- 'success', 'failure', 'pending', 'completed'
  initiator_user_id VARCHAR(255),         -- Who performed action
  initiator_reason TEXT,                  -- Why (scheduled, manual, recovery, etc.)

  -- Evidence integrity
  evidence_hash VARCHAR(64),              -- SHA256 hash of entry for tamper detection
  digital_signature TEXT,                 -- Optional digital signature for non-repudiation
  signature_algorithm VARCHAR(50),        -- 'RSA-SHA256', 'ECDSA-SHA256', etc.
  signature_timestamp TIMESTAMP WITH TIME ZONE,

  -- Context
  related_entries JSONB,                  -- {previous_entry_id, related_entries: []}
  metadata JSONB,                         -- Entry-specific context
  before_state JSONB,                     -- Previous state (for updates)
  after_state JSONB,                      -- New state (for updates)

  -- Timestamps
  event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,  -- When event actually occurred
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Archival
  archived BOOLEAN DEFAULT false,
  archive_location VARCHAR(500),          -- S3 path or archive reference

  -- Compliance hold (prevent deletion during litigation)
  on_hold BOOLEAN DEFAULT false,
  hold_id UUID
);

-- Create indexes for evidence queries
CREATE INDEX IF NOT EXISTS idx_evidence_timestamp ON evidence_entries(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_type ON evidence_entries(entry_type, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_component ON evidence_entries(component_name, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_resource ON evidence_entries(resource_type, resource_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_initiator ON evidence_entries(initiator_user_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_hash ON evidence_entries(evidence_hash);
CREATE INDEX IF NOT EXISTS idx_evidence_archived ON evidence_entries(archived, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_on_hold ON evidence_entries(on_hold);

-- Table for evidence chain integrity (Merkle tree pattern)
CREATE TABLE IF NOT EXISTS evidence_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES evidence_entries(id) ON DELETE CASCADE,
  previous_entry_id UUID REFERENCES evidence_entries(id),

  -- Chain integrity
  chain_hash VARCHAR(64) NOT NULL,        -- Hash of this entry + previous entry
  chain_valid BOOLEAN DEFAULT true,       -- Tamper detection
  chain_verified_at TIMESTAMP WITH TIME ZONE,
  chain_verified_by VARCHAR(255),

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(entry_id)
);

-- Create indexes for chain queries
CREATE INDEX IF NOT EXISTS idx_chains_entry ON evidence_chains(entry_id);
CREATE INDEX IF NOT EXISTS idx_chains_previous ON evidence_chains(previous_entry_id);
CREATE INDEX IF NOT EXISTS idx_chains_hash ON evidence_chains(chain_hash);
CREATE INDEX IF NOT EXISTS idx_chains_valid ON evidence_chains(chain_valid);

-- Table for digital signatures (non-repudiation)
CREATE TABLE IF NOT EXISTS evidence_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES evidence_entries(id) ON DELETE CASCADE,

  -- Signer information
  signer_id VARCHAR(255) NOT NULL,
  signer_certificate TEXT,               -- X.509 certificate
  certificate_chain TEXT,                -- Full chain for validation
  certificate_expiry TIMESTAMP WITH TIME ZONE,

  -- Signature details
  signature TEXT NOT NULL,                -- Digital signature (hex encoded)
  algorithm VARCHAR(50) NOT NULL,        -- 'RSA-SHA256', 'ECDSA-SHA256', etc.
  signature_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Verification
  verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMP WITH TIME ZONE,
  verification_error TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for signature queries
CREATE INDEX IF NOT EXISTS idx_signatures_entry ON evidence_signatures(entry_id);
CREATE INDEX IF NOT EXISTS idx_signatures_signer ON evidence_signatures(signer_id, signature_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_signatures_verified ON evidence_signatures(verified);

-- Table for access audit log (who accessed evidence and when)
CREATE TABLE IF NOT EXISTS evidence_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accessor_user_id VARCHAR(255) NOT NULL,
  accessed_entry_id UUID NOT NULL REFERENCES evidence_entries(id) ON DELETE CASCADE,

  -- Access details
  access_type VARCHAR(50) NOT NULL,       -- 'view', 'download', 'export', 'verify'
  purpose_stated TEXT,                    -- Why they accessed
  access_granted BOOLEAN DEFAULT true,

  -- Context
  ip_address VARCHAR(100),
  user_agent TEXT,
  accessed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for access queries
CREATE INDEX IF NOT EXISTS idx_access_entry ON evidence_access_log(accessed_entry_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_user ON evidence_access_log(accessor_user_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_time ON evidence_access_log(accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_granted ON evidence_access_log(access_granted);

-- Table for compliance holds (litigation, investigation)
CREATE TABLE IF NOT EXISTS compliance_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_type VARCHAR(100) NOT NULL,       -- 'litigation', 'investigation', 'regulatory', 'internal_audit'

  -- Hold scope
  affected_entries JSONB,                 -- {component_names: [], resource_types: [], filters: {}}
  hold_reason TEXT NOT NULL,
  legal_reference TEXT,                  -- Case number, regulation reference, etc.

  -- Hold tracking
  placed_by VARCHAR(255) NOT NULL,
  placed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by VARCHAR(255),
  released_at TIMESTAMP WITH TIME ZONE,

  -- Status
  active BOOLEAN DEFAULT true,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for hold queries
CREATE INDEX IF NOT EXISTS idx_holds_active ON compliance_holds(active);
CREATE INDEX IF NOT EXISTS idx_holds_placed ON compliance_holds(placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_holds_released ON compliance_holds(released_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_evidence_entries_hold'
  ) THEN
    ALTER TABLE evidence_entries
      ADD CONSTRAINT fk_evidence_entries_hold
      FOREIGN KEY (hold_id) REFERENCES compliance_holds(id);
  END IF;
END $$;

-- Table for archival tracking
CREATE TABLE IF NOT EXISTS evidence_archival (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Archive details
  archive_date DATE NOT NULL,
  entry_count INT NOT NULL,
  total_size_bytes BIGINT,

  -- Archive location
  archive_location VARCHAR(500) NOT NULL, -- 's3://bucket/path' or similar
  retention_category VARCHAR(100),       -- '90_days_hot', '7_years_legal', etc.
  expiry_date DATE,

  -- Integrity
  checksum VARCHAR(64),                  -- SHA256 of archive for verification
  entries_archived JSONB,                -- List of entry IDs in archive

  -- Metadata
  archived_by VARCHAR(255) NOT NULL,
  archived_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for archival queries
CREATE INDEX IF NOT EXISTS idx_archival_date ON evidence_archival(archive_date DESC);
CREATE INDEX IF NOT EXISTS idx_archival_category ON evidence_archival(retention_category);
CREATE INDEX IF NOT EXISTS idx_archival_expiry ON evidence_archival(expiry_date);

-- Update triggers for timestamps
CREATE OR REPLACE FUNCTION update_evidence_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS compliance_holds_update ON compliance_holds;
CREATE TRIGGER compliance_holds_update BEFORE UPDATE ON compliance_holds
FOR EACH ROW EXECUTE FUNCTION update_evidence_timestamp();

-- Views for evidence management

-- Evidence timeline (all entries chronologically)
CREATE OR REPLACE VIEW observability.evidence_timeline AS
SELECT
  ee.id,
  ee.entry_type,
  ee.component_name,
  ee.resource_type,
  ee.resource_id,
  ee.action,
  ee.status,
  ee.initiator_user_id,
  ee.event_timestamp,
  ec.chain_valid,
  es.verified as signature_verified,
  ee.on_hold,
  ee.archived
FROM evidence_entries ee
LEFT JOIN evidence_chains ec ON ec.entry_id = ee.id
LEFT JOIN evidence_signatures es ON es.entry_id = ee.id
ORDER BY ee.event_timestamp DESC;

-- Chain verification status
CREATE OR REPLACE VIEW observability.evidence_chain_verification AS
SELECT
  ee.id,
  ee.event_timestamp,
  ec.chain_valid,
  ec.chain_verified_at,
  CASE WHEN ec.chain_valid = false THEN 'TAMPERED'
       WHEN es.verified = false THEN 'UNVERIFIED'
       WHEN ee.on_hold = true THEN 'ON_HOLD'
       ELSE 'VALID' END as verification_status,
  COUNT(CASE WHEN eal.access_granted = true THEN 1 END) as access_count
FROM evidence_entries ee
LEFT JOIN evidence_chains ec ON ec.entry_id = ee.id
LEFT JOIN evidence_signatures es ON es.entry_id = ee.id
LEFT JOIN evidence_access_log eal ON eal.accessed_entry_id = ee.id
GROUP BY ee.id, ee.event_timestamp, ec.chain_valid, ec.chain_verified_at,
         es.verified, ee.on_hold;

-- Access audit trail
CREATE OR REPLACE VIEW observability.evidence_access_audit AS
SELECT
  eal.accessed_entry_id,
  COUNT(*) as access_count,
  COUNT(DISTINCT eal.accessor_user_id) as unique_accessors,
  MIN(eal.accessed_at) as first_access,
  MAX(eal.accessed_at) as last_access,
  array_agg(DISTINCT eal.accessor_user_id) as accessors,
  array_agg(DISTINCT eal.access_type) as access_types
FROM evidence_access_log eal
GROUP BY eal.accessed_entry_id;

-- Compliance retention status
CREATE OR REPLACE VIEW observability.evidence_retention_status AS
SELECT
  COALESCE(ea.retention_category, 'active') as retention_category,
  COUNT(ee.id) as entry_count,
  SUM(CASE WHEN ee.archived = true THEN 1 ELSE 0 END) as archived_count,
  SUM(CASE WHEN ee.on_hold = true THEN 1 ELSE 0 END) as on_hold_count,
  MAX(ee.event_timestamp) as latest_entry,
  CASE WHEN ea.expiry_date IS NOT NULL THEN ea.expiry_date ELSE 'indefinite' END as retention_until
FROM evidence_entries ee
LEFT JOIN evidence_archival ea ON ea.id = (
  SELECT id FROM evidence_archival
  WHERE ee.id = ANY(CAST(ea.entries_archived AS UUID[]))
  ORDER BY archive_date DESC LIMIT 1
)
GROUP BY COALESCE(ea.retention_category, 'active'), ea.expiry_date;

-- Comments
COMMENT ON TABLE evidence_entries IS 'Immutable audit trail of all Stage 5 operations with hash-based tamper detection';
COMMENT ON TABLE evidence_chains IS 'Chain integrity tracking (Merkle tree) for evidence entries';
COMMENT ON TABLE evidence_signatures IS 'Digital signatures for non-repudiation and authenticity';
COMMENT ON TABLE evidence_access_log IS 'Audit trail of who accessed evidence and when';
COMMENT ON TABLE compliance_holds IS 'Legal holds preventing deletion during litigation/investigation';
COMMENT ON TABLE evidence_archival IS 'Tracking of archived evidence in cold storage';
