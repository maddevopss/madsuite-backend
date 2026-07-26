# Étage 12 — Fermeture institutionnelle de la plateforme d’extensions

## Portée vérifiée

La fermeture couvre le registre, les permissions, l’isolement d’exécution, les signatures, le cycle de vie, la certification et le catalogue.

## Preuves requises

- refus d’une activation implicite;
- refus d’un accès direct à PostgreSQL, au système de fichiers hôte, aux processus et aux variables d’environnement;
- refus d’une permission absente, révoquée ou appartenant à une autre organisation;
- refus d’un paquet modifié, expiré ou signé par une clé révoquée;
- activation impossible sans compatibilité avec le noyau;
- rollback impossible sans plan testé;
- certification impossible sans les preuves exigées;
- installation impossible sans consentement explicite de l’organisation.

## Limites connues

Le présent étage définit et teste les contrats institutionnels du backend. L’exécution réelle dans un environnement isolé, la distribution publique des paquets et la modération humaine du catalogue devront conserver ces contrats et produire leurs propres preuves opérationnelles.

## Constat

Une extension ne reçoit aucune autorité implicite. Elle demeure subordonnée aux permissions, politiques métier, frontières d’organisation et décisions humaines de MADSuite. Toute identité, permission, certification ou clé peut être suspendue ou révoquée.
