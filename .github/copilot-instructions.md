# GitHub Copilot — Mode économique MAD

Répondre en français.

- Travailler uniquement sur demande explicite : assignation Copilot, mention `@copilot` ou label `copilot-review`.
- Ne jamais analyser automatiquement une PR ouverte, rouverte ou synchronisée.
- Examiner uniquement le diff et les fichiers modifiés.
- Ne jamais parcourir tout le dépôt ou tout l’historique.
- Lire un fichier non modifié seulement lorsqu’il est indispensable pour comprendre une dépendance directe du diff.
- Produire un seul commentaire consolidé par demande, avec au plus 5 constats et 120 mots par constat.
- Ne pas répondre automatiquement aux commentaires suivants.
- Ne pas créer de branche, commit, correctif ou PR sans demande explicite distincte.
- Ne pas réanalyser le même SHA.
- Arrêter et demander une réduction de portée au-delà de 20 fichiers ou 1 500 lignes modifiées.
- Exécuter uniquement les validations ciblées sur les fichiers modifiés; ne jamais lancer toute la suite de tests par défaut.
- En cas d’échec, ne rapporter que les 30 dernières lignes utiles.
- Ne jamais attendre ni surveiller la CI après un push.

Si aucun problème vérifiable n’est trouvé, répondre uniquement :

> Aucun problème vérifiable détecté dans les fichiers modifiés.
