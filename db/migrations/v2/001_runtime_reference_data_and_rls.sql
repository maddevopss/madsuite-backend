-- Données de référence indispensables au runtime après restauration de la baseline v2.
-- Toutes les opérations sont idempotentes afin de permettre un rejeu sûr.

INSERT INTO retry_policies (
  policy_name,
  description,
  backoff_strategy,
  initial_backoff_seconds,
  backoff_multiplier,
  max_backoff_seconds,
  max_attempts,
  max_total_duration_seconds,
  permanent_error_codes
) VALUES
  ('aggressive', 'Fast retries for critical operations', 'exponential', 10, 1.5, 300, 5, 900, '{"401", "403", "404", "422", "429"}'),
  ('moderate', 'Balanced retry strategy', 'exponential', 60, 2.0, 1800, 4, 3600, '{"401", "403", "404", "422"}'),
  ('conservative', 'Long wait times for stable systems', 'linear', 300, 1.0, 3600, 3, 7200, '{"401", "403", "404"}'),
  ('email_delivery', 'Extended retries for email delivery', 'exponential', 60, 2.0, 3600, 6, 14400, '{"401", "403", "404", "422"}'),
  ('webhook', 'Webhook delivery with reasonable timeouts', 'exponential', 30, 2.0, 900, 5, 1800, '{"401", "403", "404"}'),
  ('api_call', 'API integration with rate limit handling', 'exponential', 60, 1.5, 1800, 4, 3600, '{"401", "403", "404", "422"}')
ON CONFLICT (policy_name) DO NOTHING;

INSERT INTO event_handlers (
  handler_name,
  display_name,
  description,
  timeout_seconds,
  max_attempts,
  retry_policy_name,
  enabled,
  notify_on_failure,
  owner_team,
  owner_email,
  tags
) VALUES
  ('email_reminder', 'Email Reminder', 'Send reminder emails via SMTP', 30, 3, 'email_delivery', true, true, 'marketing', 'marketing@company.com', '{"email", "notifications"}'),
  ('webhook_delivery', 'Webhook Delivery', 'Deliver events to webhook endpoints', 15, 4, 'webhook', true, true, 'integrations', 'integrations@company.com', '{"webhook", "external"}'),
  ('sms_notification', 'SMS Notification', 'Send SMS notifications', 20, 2, 'aggressive', true, true, 'growth', 'growth@company.com', '{"sms", "notifications"}'),
  ('api_call', 'API Call', 'Make outbound API calls', 25, 3, 'api_call', true, true, 'platform', 'platform@company.com', '{"api", "external"}'),
  ('payment_processing', 'Payment Processing', 'Process payment transactions', 60, 2, 'conservative', true, true, 'billing', 'billing@company.com', '{"payment", "critical"}')
ON CONFLICT (handler_name) DO NOTHING;

INSERT INTO backup_retention_policy (
  backup_type,
  retention_days,
  min_backups_to_keep,
  size_quota_gb,
  auto_purge,
  description
) VALUES
  ('full', 30, 7, 50, true, 'Full backups: keep 7 daily + retain for 30 days'),
  ('incremental', 7, 24, 10, true, 'Incremental backups: keep 24 hourly + 7 days'),
  ('schema_only', 365, 1, 5, false, 'Schema backups: keep indefinitely (audit trail)'),
  ('data_only', 7, 3, 20, true, 'Data-only backups: keep 3 recent, 7 days')
ON CONFLICT (backup_type) DO NOTHING;

INSERT INTO health_check_thresholds (
  probe_name,
  component_name,
  warning_threshold,
  critical_threshold,
  enabled,
  check_interval_seconds,
  description
) VALUES
  ('schema_consistency', 'schema_inventory', '{"schema_changes": 1}'::jsonb, '{"schema_changes": 1}'::jsonb, true, 300, 'Detect breaking schema changes'),
  ('job_registry_health', 'job_registry', '{"failed_jobs": 1, "overdue_jobs": 1}'::jsonb, '{"failed_jobs": 3, "overdue_jobs": 3}'::jsonb, true, 300, 'Monitor job execution health'),
  ('job_lock_tracking', 'job_registry', '{"stuck_locks": 1}'::jsonb, '{"stuck_locks": 3}'::jsonb, true, 300, 'Detect stuck or deadlocked jobs'),
  ('quarantine_queue_size', 'retry_engine', '{"max_items": 50, "max_age_seconds": 86400}'::jsonb, '{"max_items": 100, "max_age_seconds": 86400}'::jsonb, true, 300, 'Monitor dead-letter queue growth'),
  ('retry_policy_compliance', 'retry_engine', '{"incomplete_policies": 0}'::jsonb, '{"incomplete_policies": 1}'::jsonb, true, 3600, 'Validate retry policy configuration'),
  ('outbox_pending_events', 'outbox_processor', '{"max_pending": 500, "max_age_seconds": 3600}'::jsonb, '{"max_pending": 1000, "max_age_seconds": 3600}'::jsonb, true, 300, 'Monitor outbox event backlog'),
  ('outbox_delivery_latency', 'outbox_processor', '{"max_avg_latency_ms": 10000}'::jsonb, '{"max_avg_latency_ms": 30000}'::jsonb, true, 300, 'Monitor event delivery performance'),
  ('recovery_operations', 'retry_engine', '{"recovery_failure_rate": 0.2}'::jsonb, '{"recovery_failure_rate": 0.5}'::jsonb, true, 300, 'Monitor quarantine recovery success rate')
ON CONFLICT (probe_name, component_name) DO NOTHING;

ALTER TABLE analytics_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE analytics_insights FORCE ROW LEVEL SECURITY;
ALTER TABLE custom_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE help_chat_context FORCE ROW LEVEL SECURITY;
ALTER TABLE help_chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE help_chat_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE help_search_index FORCE ROW LEVEL SECURITY;
ALTER TABLE insight_interactions FORCE ROW LEVEL SECURITY;
ALTER TABLE metric_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE real_time_metrics FORCE ROW LEVEL SECURITY;
