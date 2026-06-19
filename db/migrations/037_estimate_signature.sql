-- 037_estimate_signature.sql
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS signature_data TEXT,
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_ip VARCHAR(50);
