# Étage 6 — Registre des risques résiduels

**Date** : 2026-08-05
**Statut** : Vérifié manuellement contre le code réel, pas généré automatiquement.

Ce registre liste ce qui reste ouvert après les PR A→H et la PR B d'isolation (#741), pour que la fermeture de #174 ne masque pas de dette réelle. Complète `STAGE6_ISOLATION_REPORT.md`.

## Risques ouverts

### R1 — 4 services Stage 6 sans route HTTP
**Sévérité** : moyenne (pas d'exposition actuelle, mais logique non branchée = valeur non livrée)
**Détail** : `authenticationSessionService`, `dependenciesBuildChainService`, `sensitiveDataProtectionService`, `sensitiveTransitionService` n'ont aucune route Express. Seuls leurs tests d'intégration les exercent. Voir `STAGE6_ISOLATION_REPORT.md` §3.
**Action recommandée** : décider explicitement, service par service, si un branchement HTTP est prévu à court terme ou si ces services restent des fondations internes pour l'instant. Pas d'urgence sécurité (rien n'est exposé), mais l'ambiguïté actuelle ne doit pas être confondue avec "terminé".

### R2 — Frontend Stage 6 non fonctionnel
**Sévérité** : basse (pas de risque sécurité — l'absence d'UI n'expose rien — mais fausse l'état de complétion perçu)
**Détail** : le composant `RateLimitAlert` (seul livrable frontend réel de PR H) n'est monté nulle part dans `madsuite-frontend` et n'écoute aucun event `window`. Les 4 autres PR (D, E, F, C) n'ont aucun livrable frontend du tout, malgré `docs/STAGE6_FRONTEND_CLOSURE.md` annonçant "Frontend ✅" partout.
**Action recommandée** : soit brancher réellement le composant (écouter les events, l'afficher dans le layout), soit supprimer/corriger `STAGE6_FRONTEND_CLOSURE.md` pour ne pas induire en erreur une future revue.

### R3 — Couverture E2E limitée à un seul module
**Sévérité** : basse
**Détail** : une seule suite e2e réelle (`stage6-rate-limiting-abuse.spec.js`), pas de couverture e2e pour authentification, dépendances, protection des données sensibles ou transitions sensibles — malgré `docs/STAGE6_E2E_CLOSURE.md` annonçant 7 suites.
**Action recommandée** : si ces 4 services restent sans route HTTP (R1 non résolu), l'e2e n'a de toute façon rien à tester dessus — R1 est bloquant pour R3.

### R4 — Documents de clôture historiques non fiables
**Sévérité** : basse mais opérationnellement gênante
**Détail** : `docs/STAGE6_SECURITY_CLOSURE.md`, `docs/STAGE6_IMPLEMENTATION_METRICS.md` (ce repo), `docs/STAGE6_FRONTEND_CLOSURE.md` (madsuite-frontend), `docs/STAGE6_E2E_CLOSURE.md` (e2e) contiennent des métriques non vérifiées, dont au moins une fonctionnalité entièrement inexistante ("PR B — Cryptographic Integrity & Chain", jamais implémentée sous ce nom ni un autre — l'isolation par organisation réelle est celle de ce rapport, sans rapport avec la description de la PR B fabriquée).
**Action recommandée** : annoter ces 4 fichiers d'un avertissement pointant vers `STAGE6_ISOLATION_REPORT.md` et ce registre (fait dans ce repo pour les 2 fichiers concernés ; à répliquer dans `madsuite-frontend` et `e2e` si jugé utile), ou les supprimer si jugé plus sûr.

### R5 — Dette de couverture RLS pré-existante, indépendante de Stage 6
**Sévérité** : information, pas une action à ce stade
**Détail** : en vérifiant PR B sous un rôle Postgres non-superuser représentatif de la prod (méthodologie détaillée dans `STAGE6_ISOLATION_REPORT.md`), la suite complète du repo affiche déjà 110 suites / 502 tests en échec sur `main` **avant** PR B — une dette totalement indépendante de Stage 6, jamais mesurée dans ces conditions jusqu'ici puisque tous les runs précédents utilisaient un rôle superuser qui contourne RLS silencieusement.
**Action recommandée** : hors scope de #174, mais à tracker séparément — c'est un signal que la suite de tests de ce repo n'a globalement jamais été validée dans des conditions représentatives de la prod pour tout ce qui touche RLS.

## Risques fermés (pour référence)

- ~~Aucune policy RLS sur 142+10 tables~~ → fermé par PR B (#741).
- ~~Trigger de création d'organisation cassé sous RLS forcée~~ → fermé par PR B (#741).
- ~~Fixture FK manquante, table legacy réutilisée, fichiers de test tronqués, colonne manquante, cast COUNT manquant~~ → fermés au fil des PR #739, #731-735.
- ~~Bug d'idempotence sur 3 routes de liaison intermodules~~ → hors périmètre Stage 6 (Étage 3, issue #171), fermé par PR #744.
