-- 20260731_accounting_entries_add_metadata.sql
-- accounting-ledger.service.js (getLedger) lit/projette e.metadata (JSONB, pour les
-- filtres projectId/clientId/supplierId) mais la colonne n'existe pas sur
-- accounting_entries : /accounting/ledger échoue avec "column e.metadata does not exist"
-- dès que la requête touche le CTE filtered_entries, quelle que soit la valeur des filtres
-- (les colonnes référencées doivent exister à l'analyse de la requête, pas seulement à
-- l'exécution).

ALTER TABLE accounting_entries
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
