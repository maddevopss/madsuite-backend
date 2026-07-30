-- 049_create_stripe_webhook_events.sql
-- Table pour l'idempotence des webhooks Stripe
-- Chaque événement Stripe est enregistré avec son ID unique
-- Une contrainte UNIQUE sur stripe_event_id garantit qu'un même événement
-- ne peut être traité qu'une seule fois, même s'il est reçu plusieurs fois
-- 
-- Statuts :
-- - processing : événement en cours de traitement
-- - processed : événement traité avec succès
-- - failed : traitement échoué, peut être retenté

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    id BIGSERIAL PRIMARY KEY,
    stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'processing',
    attempts INTEGER NOT NULL DEFAULT 1,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_id
    ON stripe_webhook_events(stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status
    ON stripe_webhook_events(status);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
    ON stripe_webhook_events(processed_at);
