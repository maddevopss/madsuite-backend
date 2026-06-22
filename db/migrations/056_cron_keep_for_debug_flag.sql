-- Ajout du flag keep_for_debug pour permettre la conservation manuelle de logs critiques
ALTER TABLE cron_execution_logs ADD COLUMN IF NOT EXISTS keep_for_debug BOOLEAN DEFAULT false;
