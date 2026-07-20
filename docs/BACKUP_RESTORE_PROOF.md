# Preuve P0 — sauvegarde et restauration PostgreSQL

Ce document définit la procédure opératoire liée à `bleeband/SYSTEME_MAD#79`.

## Objectif

Démontrer qu’une base MADSuite représentative peut être sauvegardée puis restaurée dans une base vierge sans perdre :

- les migrations;
- les contraintes et index;
- les politiques RLS;
- les organisations et données métier;
- les factures et écritures du ledger.

## Prérequis

- PostgreSQL 16 ou version compatible;
- `pg_dump`, `pg_restore` et `psql` disponibles dans le `PATH`;
- une base source de test représentative;
- une base cible dédiée et jetable;
- les variables `SOURCE_DATABASE_URL` et `TARGET_DATABASE_URL` définies;
- aucune base de production utilisée comme cible.

## Garde destructive

Le script refuse de nettoyer la base cible sauf si :

```powershell
$env:MADPROOF_ALLOW_DESTRUCTIVE_RESTORE = "YES"
```

La valeur doit être fournie explicitement pour chaque session.

## Exécution Windows

```powershell
$env:SOURCE_DATABASE_URL = "postgresql://.../madsuite_source_test"
$env:TARGET_DATABASE_URL = "postgresql://.../madsuite_restore_test"
$env:MADPROOF_ALLOW_DESTRUCTIVE_RESTORE = "YES"

powershell -ExecutionPolicy Bypass -File scripts/prove-backup-restore.ps1
```

## Preuves produites

Le script crée un dossier daté sous `artifacts/backup-restore/` contenant :

- le dump PostgreSQL au format custom;
- les comptes avant et après restauration;
- la liste des migrations;
- la liste des politiques RLS;
- la liste des contraintes et index critiques;
- un résumé final `proof-summary.txt`.

Le dossier `artifacts/` doit rester hors Git.

## Invariants vérifiés

Le script compare au minimum :

- nombre d’organisations;
- nombre d’utilisateurs;
- nombre de clients;
- nombre de projets;
- nombre d’entrées de temps;
- nombre de factures;
- nombre d’écritures ledger;
- nombre de migrations;
- nombre de politiques RLS.

Il échoue si une table facultative n’existe pas uniquement lorsqu’elle est déclarée critique dans le script. Les tables obligatoires sont :

- `organisations`;
- `utilisateurs`;
- `clients`;
- `projets`;
- `invoices`;
- `ledger_entries`.

## Validation applicative finale

Après restauration :

```powershell
$env:DATABASE_URL = $env:TARGET_DATABASE_URL
npm run db:migrate
npm run test:security -- --runInBand
```

Puis démarrer le backend sur la base restaurée et vérifier :

- un endpoint de santé;
- un login de test;
- une lecture métier limitée à l’organisation du compte;
- l’absence de fuite inter-organisation.

## Critère de fermeture

L’issue P0 peut être fermée seulement lorsqu’un rapport daté confirme :

1. sauvegarde réussie;
2. restauration dans une base vierge réussie;
3. invariants identiques;
4. politiques RLS présentes;
5. backend capable de démarrer sur la base restaurée;
6. preuve référencée dans le journal MADPROOF.
