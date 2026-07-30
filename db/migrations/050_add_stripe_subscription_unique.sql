-- 050_add_stripe_subscription_unique.sql
-- Ajouter index unique partiel sur stripe_subscription_id
-- 
-- Raison : Garantir qu'une subscription Stripe ne peut être liée qu'à une seule organisation
-- Cela prévient les doublons locaux et renforce l'idempotence
-- 
-- PostgreSQL autorise plusieurs valeurs NULL avec une contrainte unique standard.
-- Un index unique partiel permet de :
-- 1. Ignorer les valeurs NULL
-- 2. Garantir l'unicité des valeurs non-NULL
-- 3. Accélérer les recherches

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_stripe_subscription_id_unique
ON organisations (stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;
