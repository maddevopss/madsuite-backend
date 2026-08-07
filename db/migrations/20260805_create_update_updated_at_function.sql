-- Migration: Create update_updated_at_column function
-- Date: 2026-08-05
-- Purpose: Provide reusable function for updating updated_at timestamps
-- This function must be created BEFORE any migration that uses it

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
