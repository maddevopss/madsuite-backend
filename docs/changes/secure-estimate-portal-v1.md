# Soumissions publiques sécurisées V1

Cette livraison remplace l’accès public par UUID aux soumissions par des liens opaques, expirables et révocables.

Le parcours couvert est :

- création et rotation d’un lien sécurisé;
- consultation publique sans identifiants internes;
- acceptation ou refus avec nom du signataire;
- consentement explicite obligatoire pour accepter;
- décision unique, idempotente et horodatée;
- conversion unique en facture;
- conversion en projet réservée aux soumissions déjà acceptées;
- rappel par courriel utilisant uniquement un nouveau jeton sécurisé;
- isolation entre organisations.
