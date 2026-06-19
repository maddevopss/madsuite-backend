-- 036_smart_billing.sql

ALTER TABLE projets 
  ADD COLUMN IF NOT EXISTS billing_increment INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS billing_rounding_type VARCHAR(10) DEFAULT 'exact' CHECK (billing_rounding_type IN ('exact', 'up', 'nearest'));

COMMENT ON COLUMN projets.billing_increment IS 'Incrément de facturation en minutes (ex: 1, 5, 15, 30)';
COMMENT ON COLUMN projets.billing_rounding_type IS 'Type d''arrondi de facturation (exact, up, nearest)';
