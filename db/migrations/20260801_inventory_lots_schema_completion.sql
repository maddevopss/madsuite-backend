-- MADSuite — complète le schéma de inventory_lots resté incomplet à cause
-- d'une collision entre deux migrations.
--
-- 20260727222000_inventory_complete_block.sql avait l'intention de créer
-- inventory_lots avec location_id, quantity, et un statut par défaut
-- 'available' (vocabulaire : available/reserved/quarantined/expired/
-- consumed/disposed). Comme la table existait déjà depuis
-- 20260727200000_inventory_lot_serial_traceability.sql, son
-- CREATE TABLE IF NOT EXISTS n'a rien fait ; son bloc
-- ALTER TABLE ADD COLUMN IF NOT EXISTS n'ajoutait que
-- serial_number/received_at/expires_at/unit_cost/evidence — ni location_id
-- ni quantity — et ne touchait pas la contrainte CHECK de statut héritée de
-- la première migration (active/quarantined/expired/consumed/recalled), qui
-- n'autorise ni 'available' ni 'disposed'.
--
-- Conséquence réelle : quantity était toujours NULL, donc
-- validateLotDisposition (inventory-complete.service.js) rejetait
-- systématiquement toute demande de disposition avec
-- inventory.lot.quantity_invalid, avant même d'atteindre la contrainte de
-- statut. POST /inventory/lots/:id/disposition était donc totalement non
-- fonctionnelle, quel que soit le statut demandé.

ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES inventory_locations(id);
ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0);

ALTER TABLE inventory_lots ALTER COLUMN status SET DEFAULT 'available';

-- Union des deux vocabulaires plutôt que remplacement : n'enlève aucune
-- valeur déjà acceptée, ajoute celles attendues par le code applicatif
-- actuel (available, disposed).
ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS inventory_lots_status_check;
ALTER TABLE inventory_lots ADD CONSTRAINT inventory_lots_status_check
  CHECK (status IN ('active','available','reserved','quarantined','expired','consumed','disposed','recalled'));

CREATE INDEX IF NOT EXISTS idx_inventory_lots_location ON inventory_lots(organisation_id, location_id);
