# Mémoire institutionnelle technique

> **Étage :** 12 — évolution continue et transmission  
> **Bloc :** PR B — mémoire institutionnelle technique  
> **Statut :** actif  
> **Autorité :** `maddevopss/SYSTEME_MAD`

Ce répertoire conserve les connaissances techniques durables qui ne doivent pas dépendre d’une personne ou d’une lecture implicite du code.

## Règles

- Documenter un invariant, une règle ou un piège avec une preuve vérifiable.
- Référencer le code, la migration, le test, l’incident ou la décision concerné.
- Ne pas recopier le code : expliquer l’intention, la contrainte et le mode de vérification.
- Distinguer `confirmé`, `à vérifier`, `périmé` et `remplacé`.
- Ne jamais supprimer silencieusement une connaissance historique.
- Toute modification structurelle doit renvoyer au registre ADR de `docs/architecture/decisions/`.

## Fiche obligatoire

Chaque entrée de mémoire doit préciser :

| Champ | Exigence |
| --- | --- |
| ID | Identifiant stable |
| Sujet | Invariant, règle critique ou piège |
| Statut | confirmé, à vérifier, périmé ou remplacé |
| Intention | Pourquoi la contrainte existe |
| Preuves | Fichiers, tests, migrations, incidents ou ADR |
| Vérification | Contrôle ciblé permettant de la confirmer |
| Dernière revue | Date ISO 8601 |
| Prochaine revue | Date ISO 8601 ou condition déclenchante |
| Responsable | Rôle responsable |

## Cycle de péremption

Une entrée devient **à vérifier** lorsqu’une preuve est déplacée, renommée, supprimée, échoue ou n’est plus reliée au comportement observé. Elle devient **périmée** seulement après vérification humaine et conservation de la raison. Une entrée remplacée conserve son historique et pointe vers la nouvelle entrée.

## Sources initiales recensées

- invariants métier : `src/core/business_invariants.ts`;
- contexte d’exécution : `src/core/executionContext.js`;
- migrations et ordre d’exécution : `db/migrations/`, `src/migrate/`;
- santé et cohérence : `src/services/systemHealth.service.js`, `src/jobs/systemConsistencyJob.js`;
- preuves de sauvegarde/restauration : `docs/BACKUP_RESTORE_PROOF.md`;
- décisions structurantes : `docs/architecture/decisions/`.

Les fiches détaillées doivent être ajoutées progressivement avec leurs preuves; aucune connaissance non vérifiée ne doit être présentée comme une garantie.
