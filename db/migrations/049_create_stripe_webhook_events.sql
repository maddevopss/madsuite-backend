-- 049_create_stripe_webhook_events.sql
-- Table pour l'idempotence des webhooks Stripe
-- Chaque événement Stripe est enregistré avec son ID unique
-- Une contrainte UNIQUE sur stripe_event_id garantit qu'un même événement
-- ne peut être traité qu'une seule fois, même s'il est reçu plusieurs fois

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    id SERIAL PRIMARY KEY,
    stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(255),
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_id 
    ON stripe_webhook_events(stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at 
    ON stripe_webhook_events(processed_at);
