# Guide d’administration MADSuite v1

## Responsabilités

L’administrateur gère les utilisateurs, les rôles, les modules, les paramètres d’organisation et les opérations nécessitant une confirmation explicite.

## Vérifications quotidiennes

- santé du service et de la base;
- traitements planifiés en échec;
- alertes critiques;
- erreurs d’authentification inhabituelles;
- files d’événements en attente;
- espace disque et sauvegardes récentes.

## Changements contrôlés

Avant une migration ou une publication :

1. identifier la version et le commit;
2. confirmer la sauvegarde;
3. vérifier le plan de retour arrière;
4. exécuter les migrations;
5. vérifier la santé et les parcours critiques;
6. inscrire la décision humaine.

## Incident

Conserver les faits, l’heure, la portée, les actions et les preuves. Ne jamais modifier l’historique pour masquer un incident. Révoquer les accès compromis et suivre la procédure de restauration uniquement avec une autorisation explicite.
