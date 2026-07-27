# Bloc Gestion documentaire complet

Le bloc est fermé lorsque l’organisation peut créer un dossier, ajouter des versions, faire approuver une version, relier le document à une activité, journaliser les accès et appliquer une décision de conservation ou de destruction contrôlée.

## Critères obligatoires

- dossiers, classifications et propriétaires;
- versions avec empreinte SHA-256 et historique de remplacement;
- approbations versionnées avant publication;
- liens vers employés, incidents, contrats, factures et autres activités;
- journal des consultations, téléchargements, partages, impressions, exports et signatures;
- conservation, archivage, transfert ou destruction avec justification;
- blocage automatique en présence d’un gel juridique ou d’une durée de conservation non échue;
- certificat de destruction vérifiable;
- alertes, isolation RLS, idempotence, audit et tests transversaux.

Un fichier téléversé sans version, approbation, preuve d’accès et cycle de conservation ne constitue pas une gestion documentaire complète.
