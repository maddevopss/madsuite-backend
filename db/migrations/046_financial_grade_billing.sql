-- 1. Invoices
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS version INT DEFAULT 1,
ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS snapshot JSONB,
ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);

-- 2. Invoice Items
ALTER TABLE invoice_items
ADD COLUMN IF NOT EXISTS original_description TEXT;

-- 3. Ledger Entries
CREATE TABLE IF NOT EXISTS ledger_entries (
    id SERIAL PRIMARY KEY,
    organisation_id INT REFERENCES organisations(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'CAD' NOT NULL,
    reference_type VARCHAR(50) NOT NULL,
    reference_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_org_ref ON ledger_entries(organisation_id, reference_type, reference_id);

-- 4. AI Audit Logs
CREATE TABLE IF NOT EXISTS ai_audit_logs (
    id SERIAL PRIMARY KEY,
    organisation_id INT REFERENCES organisations(id) ON DELETE CASCADE,
    invoice_id INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    output TEXT NOT NULL,
    model VARCHAR(50) NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_invoice_id ON ai_audit_logs(invoice_id);
