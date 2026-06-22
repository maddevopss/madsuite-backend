CREATE TABLE IF NOT EXISTS email_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'sent',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_email_delivery_log_idempotency_key ON email_delivery_log(idempotency_key);
