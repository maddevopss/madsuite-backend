# Bloc F — Fondation, configuration et permissions

Ce bloc couvre la fondation installable et sécurisée du module comptable.

## Critères obligatoires

- migrations montantes et validation du schéma;
- initialisation idempotente du plan comptable fr-CA;
- comptes système protégés et hiérarchie valide;
- périodes ouvertes, fermées ou verrouillées;
- permissions distinctes pour consulter, saisir, publier, contrepasser et clôturer;
- messages compréhensibles;
- preuves PostgreSQL, HTTP et multi-organisation.

La PR associée ne doit pas être fusionnée tant que ces preuves ne sont pas présentes.