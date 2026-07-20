# Preuve P0 — exécution réelle sauvegarde/restauration

## Objectif

Fermer l'issue SYSTEME_MAD #79 avec une exécution réelle, reproductible et documentée de la sauvegarde puis de la restauration PostgreSQL.

## Prérequis

- PostgreSQL client (`pg_dump`, `pg_restore`, `psql`);
- base source de test contenant des données représentatives;
- base cible vide et jetable;
- variables de connexion source et cible;
- script `scripts/prove-backup-restore.ps1` déjà présent sur `main`.

## Déroulement

1. Créer un jeu de données contenant au moins deux organisations.
2. Produire une sauvegarde horodatée avec `pg_dump`.
3. Créer une base cible vide.
4. Restaurer la sauvegarde avec `pg_restore`.
5. Vérifier les migrations et les tables attendues.
6. Vérifier les politiques RLS.
7. Démarrer le backend sur la base restaurée.
8. Exécuter un scénario métier authentifié.
9. Vérifier l'isolation multi-tenant sur la base restaurée.
10. Conserver le manifeste, les journaux et les sommes de contrôle.

## Preuves à conserver

- date et heure de l'exécution;
- version PostgreSQL;
- commande de sauvegarde;
- commande de restauration;
- taille et SHA-256 de l'archive;
- résultat des migrations;
- résultat des vérifications RLS;
- résultat du scénario métier;
- durée de sauvegarde et durée de restauration;
- verdict final PASS/FAIL.

## Commande cible sous Windows

```powershell
./scripts/prove-backup-restore.ps1 `
  -SourceDatabaseUrl $env:DATABASE_URL `
  -RestoreDatabaseUrl $env:RESTORE_DATABASE_URL
```

## Conditions de sécurité

- la base cible doit être explicitement distincte de la source;
- le script doit refuser une cible non jetable ou identique à la source;
- aucun secret ne doit apparaître dans les artéfacts;
- les archives générées ne doivent pas être commitées.

## Critère de fermeture

L'issue #79 peut être fermée seulement après une exécution réelle réussie et la publication d'un rapport de preuve sans secrets dans SYSTEME_MAD.
