# Bloc 18 — Écosystème d’intégrations

## Objectif

Permettre à MADSuite d’échanger avec des systèmes externes sans perdre l’isolation, la traçabilité ni la capacité de reprise.

## Portée complète

- webhooks signés et rejouables;
- connecteurs révocables;
- import et export validés;
- synchronisation avec curseurs et reprise;
- idempotence et déduplication;
- files d’échec et nouvelles tentatives;
- réconciliation;
- limites et sécurité des secrets;
- audit et conservation des preuves;
- approbation humaine avant activation.

## Règle de fermeture

Une intégration n’est active que lorsque la livraison, la reprise, la réconciliation, l’isolation et l’audit sont prouvés. Les automatismes proposent l’état; une personne autorisée décide de l’activation.
