-- Corrige les déclencheurs pour chaque opération et permet le statut de renversement contrôlé.

CREATE OR REPLACE FUNCTION prevent_posted_accounting_line_mutation() RETURNS trigger AS $$
DECLARE target_entry_id BIGINT;
DECLARE entry_status VARCHAR(16);
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_entry_id := NEW.entry_id;
  ELSE
    target_entry_id := OLD.entry_id;
  END IF;

  SELECT status INTO entry_status
  FROM accounting_entries
  WHERE id = target_entry_id;

  IF entry_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Les lignes d’une écriture publiée sont immuables.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ensure_accounting_period_open() RETURNS trigger AS $$
DECLARE period_status VARCHAR(16);
BEGIN
  -- Le renversement conserve l’écriture d’origine et crée une nouvelle écriture datée.
  -- Cette transition de statut ne modifie pas la période historique.
  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND NEW.status = 'reversed' THEN
    RETURN NEW;
  END IF;

  SELECT status INTO period_status
  FROM accounting_periods
  WHERE organisation_id = NEW.organisation_id
    AND NEW.entry_date BETWEEN starts_on AND ends_on
  ORDER BY starts_on DESC
  LIMIT 1;

  IF period_status IN ('closed', 'locked') THEN
    RAISE EXCEPTION 'La période comptable correspondant à cette date est fermée.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
