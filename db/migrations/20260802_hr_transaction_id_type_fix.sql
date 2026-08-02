BEGIN;

-- Bug réel trouvé en construisant la matrice de compétences par poste (le
-- test exerçant réellement POST /employee-competencies pour la première
-- fois) : hr_employees, hr_employment_events, hr_leave_requests et
-- hr_employee_competencies typent ct_mad_transaction_id en UUID, mais
-- transaction-engine.service.js::createTransactionId() produit
-- "CTM-<année>-<uuid>" (préfixé, pas un UUID valide) -- exactement le
-- format que TOUS les autres modules stockent en TEXT/VARCHAR (payroll,
-- SST, legal_compliance, document_proof, asset_maintenance). Toute
-- écriture réelle via createEmployee/transitionEmployment/decideLeave/
-- verifyCompetency échouait donc en 500 ("invalid input syntax for type
-- uuid"), et hr-transaction.service.test.js (préexistant) ne teste que
-- les fonctions pures de politique -- jamais ces quatre chemins d'écriture
-- réels -- d'où l'absence de détection jusqu'ici.
--
-- Colonnes actuellement vides ou NULL pour toute ligne existante (aucun
-- INSERT n'a jamais pu réussir avec cette contrainte) : ALTER ... TYPE
-- TEXT est un changement de type sans perte, sans conversion de données
-- réelle à risque.
ALTER TABLE hr_employees ALTER COLUMN ct_mad_transaction_id TYPE TEXT;
ALTER TABLE hr_employment_events ALTER COLUMN ct_mad_transaction_id TYPE TEXT;
ALTER TABLE hr_leave_requests ALTER COLUMN ct_mad_transaction_id TYPE TEXT;
ALTER TABLE hr_employee_competencies ALTER COLUMN ct_mad_transaction_id TYPE TEXT;

COMMIT;
