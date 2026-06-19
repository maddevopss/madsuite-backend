-- Migration 033_billing_reminders.sql

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS reminders_sent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;

ALTER TABLE estimates
ADD COLUMN IF NOT EXISTS reminders_sent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;
