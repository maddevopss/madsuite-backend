# Bloc D — Sécurité finale

## Portée

Le bloc couvre l’authentification, les sessions, les permissions, l’isolation entre organisations, les API, les dépendances, les en-têtes, les cookies, le CORS, les secrets, l’agent de bureau et les preuves d’audit.

## Preuves obligatoires

- rotation et révocation des sessions;
- permissions minimales vérifiées par rôle;
- RLS forcé et garde organisationnelle;
- validation des entrées et limitation de débit;
- en-têtes, cookies et origines explicites;
- dépendances sans vulnérabilité critique connue;
- secrets absents du dépôt et des journaux;
- refus d’accès croisé démontré;
- agent de bureau limité aux capacités autorisées;
- constats classés, corrigés ou acceptés humainement.

## Limite

Une garde statique n’est pas un test d’intrusion. La certification exige les tests ciblés, la CI et une décision humaine documentée.
