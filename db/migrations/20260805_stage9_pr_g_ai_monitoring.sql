-- Étage 9 PR G — Surveillance des dérives et coûts (issue #195).
--
-- Additions additives uniquement (ALTER ... ADD COLUMN) sur les tables
-- existantes de la PR E (ai_audit_log) et de la PR A
-- (ai_use_case_activations) :
-- - duration_ms : latence réelle de génération, mesurée par la route de
--   recommandations (PR C/E), pour calculer une latence moyenne par cas
--   d'usage sans dépendre d'un outil d'observabilité externe.
-- - disabled_reason : motif conservé lors d'une désactivation, qu'elle
--   soit manuelle (PR A) ou déclenchée par la surveillance de dérive
--   (arrêt contrôlé d'une capacité dégradée, ci-dessous).

BEGIN;

ALTER TABLE ai_audit_log ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE ai_use_case_activations ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

COMMIT;
