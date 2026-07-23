-- Migration: 091_allow_manager_role.sql
-- Purpose: Add 'manager' role to the utilisateurs table constraint
-- This migration is idempotent and safe to re-run.

-- Drop the existing constraint if it exists
ALTER TABLE utilisateurs
  DROP CONSTRAINT IF EXISTS chk_role;

-- Add the new constraint that includes 'manager'
ALTER TABLE utilisateurs
  ADD CONSTRAINT chk_role
  CHECK (role IN ('admin', 'manager', 'employe'));
