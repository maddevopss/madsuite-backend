BEGIN;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS supplier_number VARCHAR(64),
  ADD COLUMN IF NOT EXISTS legal_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS trade_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('prospect','active','on_hold','blocked','inactive')),
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'CAD',
  ADD COLUMN IF NOT EXISTS language VARCHAR(8) NOT NULL DEFAULT 'fr-CA',
  ADD COLUMN IF NOT EXISTS preferred BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS category VARCHAR(80),
  ADD COLUMN IF NOT EXISTS tax_numbers JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS compliance_status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (compliance_status IN ('pending','compliant','attention','expired','blocked')),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(180),
  ADD COLUMN IF NOT EXISTS created_by BIGINT,
  ADD COLUMN IF NOT EXISTS updated_by BIGINT;

UPDATE suppliers
SET supplier_number = COALESCE(supplier_number, 'SUP-' || LPAD(id::text, 6, '0')),
    legal_name = COALESCE(legal_name, name),
    trade_name = COALESCE(trade_name, name),
    payment_terms = CASE
      WHEN payment_terms = '{}'::jsonb THEN jsonb_build_object('days', payment_terms_days)
      ELSE payment_terms
    END;

ALTER TABLE suppliers ALTER COLUMN supplier_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_number_uidx ON suppliers (organisation_id, supplier_number);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_idempotency_uidx ON suppliers (organisation_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_id_uidx ON suppliers (organisation_id, id);

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  contact_type VARCHAR(24) NOT NULL DEFAULT 'general'
    CHECK (contact_type IN ('general','sales','billing','shipping','support','compliance','executive')),
  name VARCHAR(160) NOT NULL,
  title VARCHAR(120),
  email VARCHAR(255),
  phone VARCHAR(40),
  mobile VARCHAR(40),
  language VARCHAR(8) NOT NULL DEFAULT 'fr-CA',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, supplier_id) REFERENCES suppliers(organisation_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_contacts_primary_uidx
  ON supplier_contacts (organisation_id, supplier_id, contact_type)
  WHERE is_primary = TRUE AND is_active = TRUE;

CREATE TABLE IF NOT EXISTS supplier_addresses (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  address_type VARCHAR(24) NOT NULL DEFAULT 'business'
    CHECK (address_type IN ('business','billing','shipping','remittance','warehouse')),
  line1 VARCHAR(180) NOT NULL,
  line2 VARCHAR(180),
  city VARCHAR(120) NOT NULL,
  region VARCHAR(120),
  postal_code VARCHAR(24),
  country_code CHAR(2) NOT NULL DEFAULT 'CA',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, supplier_id) REFERENCES suppliers(organisation_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_addresses_primary_uidx
  ON supplier_addresses (organisation_id, supplier_id, address_type)
  WHERE is_primary = TRUE AND is_active = TRUE;

CREATE TABLE IF NOT EXISTS supplier_compliance_documents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  document_type VARCHAR(60) NOT NULL,
  document_number VARCHAR(120),
  issued_at DATE,
  expires_at DATE,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','valid','expired','rejected','waived')),
  file_reference JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  verified_by BIGINT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, supplier_id) REFERENCES suppliers(organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS supplier_compliance_expiry_idx
  ON supplier_compliance_documents (organisation_id, expires_at, status)
  WHERE status IN ('pending','valid');

CREATE TABLE IF NOT EXISTS supplier_audit_events (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  actor_user_id BIGINT,
  reason TEXT,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key VARCHAR(180),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, idempotency_key),
  FOREIGN KEY (organisation_id, supplier_id) REFERENCES suppliers(organisation_id, id) ON DELETE CASCADE
);

ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_compliance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_audit_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['supplier_contacts','supplier_addresses','supplier_compliance_documents','supplier_audit_events']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_policy ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_tenant_policy ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true),'''')::BIGINT) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true),'''')::BIGINT)',
      table_name, table_name
    );
  END LOOP;
END $$;

COMMIT;
