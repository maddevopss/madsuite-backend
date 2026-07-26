# Audit initial — Bloc 2 Paie complète (#318)

## État constaté

Le dépôt possède déjà un noyau de paie :

- employés horaires ou salariés;
- jeux de règles versionnés et datés;
- cycles de paie;
- calcul déterministe du brut, des retenues, des contributions employeur et du net;
- traces de calcul et sommes de contrôle;
- transitions calculé, approuvé, payé et annulé;
- idempotence et événements métier;
- isolation par organisation au niveau des requêtes et des tables existantes.

## Écarts à fermer

- enrichir le dossier employé et la rémunération;
- formaliser calendriers, périodes et éléments variables;
- couvrir primes, commissions, avantages et remboursements;
- gouverner plafonds, exemptions et règles datées;
- produire les talons et registres;
- comptabiliser les lots dans le journal général;
- ajouter rapprochement et correction non destructive;
- compléter l’interface utilisateur;
- renforcer les rôles, l’audit et les exports;
- fournir un scénario complet de fermeture.

## Décision

Les sprints du bloc #318 consolident le noyau existant. Ils ne réécrivent pas le moteur transactionnel sans preuve d’un défaut. Chaque sprint doit préserver l’idempotence, l’explicabilité, l’isolation par organisation et l’immuabilité des lots approuvés.
