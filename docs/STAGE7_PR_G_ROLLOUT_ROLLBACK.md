# Étage 7 PR G — Déploiement progressif et retour arrière

**Date** : 2026-08-05
**Statut** : Vérifié manuellement en exécutant le code réel — pas généré automatiquement.

## Pourquoi ce document existe

L'issue #175 exige, pour PR G, la preuve de quatre points : vérifications avant/après, stratégie compensatoire, retour arrière testé, procédure de retour arrière testée (décision de poursuite ou arrêt).

La branche `ops/stage7-progressive-deployment` déjà présente dans le repo partage la même lignée git divergente inexploitable que les autres branches `test/stage7-*` (voir PR #746-751). Son seul contenu réel, `src/ops/deploymentGate.js`, évalue une fonction locale contre un objet passé en paramètre — jamais appelée par un script de déploiement, une route ou un test d'intégration réel. Ce document remplace cette preuve fabriquée par une vérification réelle de ce qui existe déjà, plus deux correctifs réels.

## 1. Vérifications avant déploiement

- Suite de tests complète + `guard:*` (`check:backend`) — déjà exigée avant tout push par les règles CLAUDE.md de ce repo.
- `src/test/migrations.integration.test.js` + `migrations.065.integration.test.js` : migrations depuis zéro, vérifiées réellement (voir PR F, #175).

## 2. Vérifications après déploiement

- `src/observability/healthRoutes.js`, monté à `/api/observability`, et `GET /api/health` (`app.js:152`) — sondes de disponibilité déjà réelles et testées (PR F, 31/31 tests).

## 3. Stratégie compensatoire (réversibilité des migrations)

**Constat de vérification** : `db/migrations/*.sql` ne contient aucun `DROP TABLE` ni `DROP COLUMN` — la discipline « additive seulement » est déjà suivie en pratique. C'est la stratégie compensatoire elle-même : une migration additive peut rester en place sans danger si le déploiement qui la consomme est retourné en arrière ; une migration destructrice, non.

**Lacune trouvée et corrigée** : cette propriété n'était qu'accidentelle (personne ne l'avait rendue impossible à violer), et `db/archive/migrations/028_partition_security_buffer.sql` contenait effectivement un `DROP TABLE` — en commentaire de développeur, jamais exécuté, mais rien ne distinguait ce cas d'un vrai `DROP TABLE` exécutable avant l'écriture de ce garde-fou. Corrigé par `scripts/guard-migration-reversibility.js` (nouveau, câblé dans `package.json` → `guard:migration-reversibility` et dans `check:backend`, et dans les workflows CI `backend-guards.yml`/`backend-main-guards.yml`) : toute migration avec un `DROP TABLE`/`DROP COLUMN` réellement exécutable fait échouer la CI, sauf reconnaissance explicite via `-- ROLLBACK-ACKNOWLEDGED: <justification>`. Vérifié dans les deux sens (voir historique de commit : un `DROP TABLE` de test sans reconnaissance échoue, avec reconnaissance passe ; le faux positif sur le commentaire de `028_partition_security_buffer.sql` est corrigé en excluant les lignes `--` de l'analyse).

**Constat additionnel, non corrigé ici** : `scripts/guard-production-readiness.js` existe déjà dans le repo mais n'est câblé nulle part (ni `package.json`, ni aucun workflow CI) et se limite de toute façon à une recherche de mots-clés (`/rollback|retour arrière/i` quelque part dans `src`/`docs`/`.github`) sans vérifier qu'un mécanisme réel existe. Pas câblé dans cette PR : le corriger correctement demanderait de le réécrire, hors périmètre raisonnable ici — signalé pour ne pas rester implicite.

## 4. Retour arrière testé (données)

- `.github/workflows/backup-restore-proof.yml` (déjà existant, PR G de l'Étage 5, #173) : exécute un vrai exercice de sauvegarde/restauration en CI — migrations réelles depuis zéro sur une base source, données multi-tenant et financières représentatives (organisations, factures, webhook Stripe reconcilié), restauration destructrice sur une base cible isolée, puis vérification d'invariants réels après restauration (comptes d'organisations/clients/factures, ligne de grand livre append-only avec montant exact, RLS toujours active).
- `src/test/stage5Backup.integration.test.js` : 42 tests d'intégration réels (sauvegarde complète/incrémentale/schéma, restauration complète/sélective/point-in-time, rollback de restauration, rétention) — déjà vérifiés verts (PR F, #175).

## 5. Décision de poursuite ou arrêt

- `src/services/productionReadinessGate.service.js` (déjà existant, testé par `src/test/production-readiness-gate.test.js`) : porte de décision explicite, `decisionAuthority: 'human'` — refuse `ready: true` tant que `rollbackValidated`, `migrationsValidated`, `backupRestoreValidated`, etc. ne sont pas tous `true` ET qu'une approbation humaine (`approvedBy`/`approvedAt`) n'est pas fournie. Cette PR fournit maintenant une preuve réelle pour alimenter `rollbackValidated`/`migrationsValidated` avec de vraies preuves (§3, §4) plutôt que des booléens déclarés sans base.

## Conclusion

Les quatre exigences de PR G sont couvertes par du code existant, plus un garde-fou réel nouveau (réversibilité des migrations) qui transforme une propriété jusqu'ici accidentelle en propriété structurellement garantie. Aucun nouveau service de façade n'a été ajouté — `src/ops/deploymentGate.js` de la branche orpheline aurait dupliqué, en moins bien (jamais appelé, jamais testé), ce qui existe déjà via `productionReadinessGate.service.js`.
