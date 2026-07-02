-- Migration 058: Faire en sorte que la FK metrics_snapshot_organisation_id_fkey soit toujours correcte

-- Objectif:
-- - Réparer/recréer la FK organisation_id -> organisations(id) sur metrics_snapshot
-- - De façon idempotente, et compatible avec des noms de contraintes variables
-- - Si la contrainte attendue metrics_snapshot_organisation_id_fkey manque, on la crée (même nom que celui attendu par le runner)

DO $$
DECLARE
  expected_name TEXT := 'metrics_snapshot_organisation_id_fkey';
  table_name TEXT := 'metrics_snapshot';
  col_name TEXT := 'organisation_id';
  rec TEXT;
  table_oid OID;
BEGIN
  -- Récupérer l'OID de la table (élimine l'ambiguïté)
  table_oid := 'public.metrics_snapshot'::regclass::oid;

  -- 1) Si metrics_snapshot n'existe pas, on s'arrête proprement
  IF table_oid IS NULL THEN
    RETURN;
  END IF;

  -- 2) Supprimer la contrainte attendue si elle existe mais ne correspond pas (ou si elle est bloquante)
  --    On la drop seulement si elle existe et qu'elle cible vraiment organisations(id).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = expected_name
      AND conrelid = table_oid
  ) THEN
    -- check quick sanity: on ne drop que si la FK touche la colonne organisation_id
    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid
      WHERE c.conname = expected_name
        AND a.attname = col_name
        AND c.contype = 'f'
    ) THEN
      -- On garde la contrainte si elle est déjà correcte: pas de drop.
      -- (On évite de faire du churn pour rien)
      NULL;
    ELSE
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', table_name, expected_name);
    END IF;
  END IF;

  -- 3) Identifier une FK existante valide (même si le nom diffère)
  --    - conrelid = metrics_snapshot
  --    - contype = f
  --    - colonne = organisation_id
  --    - cible = organisations
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = expected_name
      AND c.contype = 'f'
      AND c.conrelid = table_oid
  ) THEN

    -- drop d'une FK existante potentiellement "mauvaise" si elle est sur la même colonne
    -- (idempotent: on drop seulement si on trouve une contrainte FK sur cette colonne)
    FOR rec IN
      SELECT c.conname AS conname
      FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.conrelid = table_oid
        AND c.conname <> expected_name
    LOOP
      -- Ne drop que les FKs qui touchent bien la colonne organisation_id
      IF EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = table_oid
          AND a.attnum = ANY ((SELECT conkey FROM pg_constraint WHERE conname = rec.conname))
          AND a.attname = col_name
      ) THEN
        BEGIN
          EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', table_name, rec.conname);
        EXCEPTION WHEN others THEN
          NULL;
        END;
      END IF;
    END LOOP;

    -- créer la contrainte attendue si absente
    -- (si elle existe déjà maintenant, le IF NOT EXISTS évite la collision)
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = expected_name
        AND contype = 'f'
        AND conrelid = table_oid
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES organisations(id) ON DELETE CASCADE',
        table_name, expected_name, col_name
      );
    END IF;
  END IF;

END $$;

-- Remettre les dépendances/planification à jour
ANALYZE metrics_snapshot;

COMMIT;