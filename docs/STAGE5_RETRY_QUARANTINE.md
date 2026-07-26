# Étage 5C — Reprises, tentatives et quarantaine

Les traitements récupérables utilisent un délai progressif borné. Après le nombre maximal de tentatives, le traitement quitte la file active et entre en quarantaine.

Toute sortie manuelle de quarantaine exige un acteur identifié et une justification non vide. La reprise crée une nouvelle tentative traçable; elle n’efface jamais l’historique de l’échec.
