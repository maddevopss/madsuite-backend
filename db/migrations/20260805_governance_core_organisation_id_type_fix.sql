-- Issue #171 (Étage 3) PR C — préparation du branchement du service commun
-- de résolution d'autorité (governanceOrchestrator) dans finance/documents.
--
-- Bug confirmé par audit : governance_cases/governance_commands/
-- governance_approvals/governance_events (20260729_create_governance_core.sql)
-- déclarent organisation_id/actor_id/created_by/approver_id en UUID, alors
-- que organisations.id et utilisateurs.id sont des entiers (SERIAL) partout
-- ailleurs dans MADSuite. Conséquences :
--   1. tout INSERT avec un organisation_id/actor_id réel (entier) échoue
--      avec "invalid input syntax for type uuid" ;
--   2. même en supposant des UUID générés artificiellement, la politique
--      RLS (`organisation_id::text = current_setting('app.current_organisation_id')`)
--      ne peut jamais correspondre au contexte entier posé par le reste de
--      l'application — refus silencieux permanent, pas d'erreur explicite.
-- Aucun code n'écrit dans ces tables aujourd'hui (GovernanceRepository
-- n'est instancié nulle part — vérifié) : TRUNCATE sans risque avant
-- réparation, plutôt qu'une conversion UUID→INTEGER qui n'aurait de toute
-- façon aucune ligne valide à convertir.

BEGIN;

TRUNCATE TABLE governance_events, governance_approvals, governance_commands, governance_cases;

-- Postgres refuse ALTER COLUMN ... TYPE sur une colonne référencée par une
-- politique RLS : les politiques doivent être retirées avant, puis
-- recréées avec la comparaison entière une fois le type corrigé.
DROP POLICY IF EXISTS governance_cases_tenant_policy ON governance_cases;
DROP POLICY IF EXISTS governance_commands_tenant_policy ON governance_commands;
DROP POLICY IF EXISTS governance_approvals_tenant_policy ON governance_approvals;
DROP POLICY IF EXISTS governance_events_tenant_policy ON governance_events;

ALTER TABLE governance_cases
  ALTER COLUMN organisation_id TYPE INTEGER USING NULL,
  ALTER COLUMN created_by TYPE INTEGER USING NULL,
  ADD CONSTRAINT governance_cases_organisation_id_fkey
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
  ADD CONSTRAINT governance_cases_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES utilisateurs(id);

ALTER TABLE governance_commands
  ALTER COLUMN organisation_id TYPE INTEGER USING NULL,
  ALTER COLUMN actor_id TYPE INTEGER USING NULL,
  ADD CONSTRAINT governance_commands_organisation_id_fkey
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
  ADD CONSTRAINT governance_commands_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES utilisateurs(id);

ALTER TABLE governance_approvals
  ALTER COLUMN organisation_id TYPE INTEGER USING NULL,
  ALTER COLUMN approver_id TYPE INTEGER USING NULL,
  ADD CONSTRAINT governance_approvals_organisation_id_fkey
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
  ADD CONSTRAINT governance_approvals_approver_id_fkey
    FOREIGN KEY (approver_id) REFERENCES utilisateurs(id);

ALTER TABLE governance_events
  ALTER COLUMN organisation_id TYPE INTEGER USING NULL,
  ALTER COLUMN actor_id TYPE INTEGER USING NULL,
  ADD CONSTRAINT governance_events_organisation_id_fkey
    FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE,
  ADD CONSTRAINT governance_events_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES utilisateurs(id);

-- Politiques RLS recréées pour comparer deux entiers (le cast ::text
-- précédent comparait un UUID textuel à un identifiant entier — toujours
-- faux). Aligné sur le motif déjà utilisé ailleurs (ex. payroll_rulesets,
-- tax_codes) : NULLIF(...,'')::INTEGER pour tolérer un contexte non posé
-- en dehors d'une session de requête.
CREATE POLICY governance_cases_tenant_policy ON governance_cases
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);
CREATE POLICY governance_commands_tenant_policy ON governance_commands
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);
CREATE POLICY governance_approvals_tenant_policy ON governance_approvals
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);
CREATE POLICY governance_events_tenant_policy ON governance_events
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

ALTER TABLE governance_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE governance_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE governance_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE governance_events FORCE ROW LEVEL SECURITY;

COMMIT;
