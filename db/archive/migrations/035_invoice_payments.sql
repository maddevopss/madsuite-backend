-- 035_invoice_payments.sql
ALTER TABLE organisations
ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255);
