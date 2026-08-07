# Mémoire technique — invariants, règles et pièges connus

> **Version :** 1.0.0  
> **Statut :** actif  
> **Dernière revue :** 2026-08-07  
> **Prochaine revue :** 2026-11-07

## 1. Invariants de gouvernance et de sécurité

| ID | Sujet | Statut | Intention | Preuves | Vérification |
| --- | --- | --- | --- | --- | --- |
| MEM-MAD-001 | SYSTEME_MAD est l’autorité documentaire institutionnelle | confirmé | Éviter une gouvernance parallèle ou divergente | `README.md`, ADR-MAD-001 | Rechercher la source de vérité dans le README et les ADR |
| MEM-MAD-002 | L’isolation organisationnelle est une défense en profondeur | confirmé | Empêcher une fuite par oubli d’un filtre applicatif | `README.md`, `src/core/executionContext.js`, politiques RLS et guards existants | Exécuter les guards d’organisation et les tests ciblés concernés |
| MEM-MAD-003 | Les décisions assistées ne remplacent pas l’autorité humaine | confirmé | Prévenir une transition sensible implicite ou autonome | `README.md`, registre IA et preuves de l’Étage 9 | Exécuter le guard IA et les tests de confirmation humaine |

## 2. Règles critiques de données et de migrations

| ID | Sujet | Statut | Intention | Preuves | Vérification |
| --- | --- | --- | --- | --- | --- |
| MEM-MAD-004 | Une migration doit respecter l’ordre de création et de dépendance | confirmé | Garantir le déploiement depuis une base vide | `db/migrations/`, `src/migrate/verifyMigrationOrder.js`, rapports de migration | Contrôle d’ordre et déploiement de migration ciblé |
| MEM-MAD-005 | Une écriture critique conserve cohérence, autorisation et idempotence | confirmé | Éviter doublons, rejeux et mutations hors politique | plan maître des Étages 8 à 12, services transactionnels et tests contractuels | Guards de routes, contrats transactionnels et tests ciblés |

## 3. Pièges connus

| ID | Piège | Statut | Conséquence | Prévention | Preuve |
| --- | --- | --- | --- | --- | --- |
| MEM-MAD-006 | Ajouter une règle documentaire sans preuve liée | confirmé | Une garantie peut sembler active sans être vérifiable | Marquer `à vérifier` et rattacher code/test/migration/ADR | Schéma de ce registre et ADR-MAD-001 |
| MEM-MAD-007 | Modifier une migration déjà déployée pour corriger l’historique | confirmé | Divergence entre environnements et impossibilité de reconstituer l’état | Ajouter une migration corrective et conserver l’historique | `scripts/guard-migration-reversibility.js` |
| MEM-MAD-008 | Considérer un document comme actuel sans contrôler ses preuves | confirmé | La mémoire institutionnelle devient trompeuse | Revue périodique et statut de péremption explicite | Cycle de péremption de ce registre |

## 4. Liens de traçabilité

Les liens complets entre une règle et son implémentation doivent être ajoutés lorsqu’ils sont vérifiés. Une référence de chemin seule ne constitue pas une preuve de comportement; la preuve doit indiquer le contrôle ou le test qui la confirme.

## 5. Historique

- **2026-08-07 — 1.0.0 :** création de la mémoire institutionnelle technique dans le cadre de l’issue #199, PR B.
