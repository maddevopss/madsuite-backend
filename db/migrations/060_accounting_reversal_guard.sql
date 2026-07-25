-- Autoriser la transition contrôlée posted -> reversed sans rendre les écritures modifiables.

CREATE OR REPLACE FUNCTION prevent_posted_accounting_entry_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Une écriture publiée est immuable; créez une écriture de renversement.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
    IF NEW.status = 'reversed'
       AND NEW.id = OLD.id
       AND NEW.organisation_id = OLD.organisation_id
       AND NEW.journal_id = OLD.journal_id
       AND NEW.entry_number = OLD.entry_number
       AND NEW.entry_date = OLD.entry_date
       AND NEW.description = OLD.description
       AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type
       AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
       AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
       AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
       AND NEW.created_at = OLD.created_at THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Une écriture publiée est immuable; créez une écriture de renversement.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'Une écriture renversée est immuable.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
