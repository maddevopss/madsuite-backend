-- 033_stripe_subscriptions.sql

ALTER TABLE organisations 
ADD COLUMN stripe_customer_id VARCHAR(255),
ADD COLUMN stripe_subscription_id VARCHAR(255),
ADD COLUMN plan_type VARCHAR(50) DEFAULT 'free',
ADD COLUMN subscription_status VARCHAR(50) DEFAULT 'trialing',
ADD COLUMN trial_ends_at TIMESTAMPTZ;

-- Index pour accélérer les recherches lors des webhooks Stripe
CREATE INDEX idx_org_stripe_customer_id ON organisations(stripe_customer_id);
CREATE INDEX idx_org_stripe_subscription_id ON organisations(stripe_subscription_id);
