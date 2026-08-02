# CLAUDE.md — madsuite-backend

Consignes strictes pour préserver les tokens et optimiser le workflow mobile.
Priment sur les habitudes par défaut sauf instruction explicite contraire de l'utilisateur en session.

## ⚠️ Compromis assumé

Ce repo est financier/RH/paie multi-tenant avec RLS. Les règles ci-dessous
**désactivent volontairement** les filets de sécurité habituels (suite
complète, `test:security`) pour économiser des tokens en usage mobile.
Des bugs réels ont déjà été trouvés uniquement par la suite complète
(ex: mauvais type de colonne bloquant 4 chemins d'écriture RH, double
validation non bloquée). Sans ces runs, ce type de régression peut passer
inaperçu jusqu'à la review humaine ou la prod. Accepté sciemment par
l'utilisateur pour ce workflow — à revoir si des régressions silencieuses
apparaissent.

**Exception : juste avant un push final** (pas à chaque itération), lancer
une fois `npm run test:security` (~20s) et la suite Jest complète en
arrière-plan avant de pousser. Si un échec autre que les échecs Stripe
pré-existants (13, connus) apparaît, ne pas pousser tant que non résolu.

## Économie de tokens

- Concis, zéro blabla, zéro formule de politesse.
- **Jamais** de suite Jest complète, jamais `npm test` sans cible,
  pendant l'itération. Toujours scoper aux fichiers touchés par le
  changement en cours : `npx jest src/test/<fichier>.test.js --silent`
- Exception unique : juste avant le push final, lancer une fois
  `npm run test:security` + la suite complète (voir "Compromis assumé").
- **Jamais** relire tout un fichier volumineux ou tout le repo pour du
  contexte. Grep/recherche ciblée sur les symboles concernés uniquement.
- Lint/guards : uniquement si le changement touche des routes/migrations,
  et seulement en ciblant les fichiers modifiés si l'outil le permet.

## Git / CI — pas de polling

- Ne jamais attendre ou vérifier le statut du CI après un `git push`.
- Aucune boucle de vérification, aucun `sleep`, aucun polling de statut
  GitHub Actions ou de PR.
- La tâche se termine dès que le push est fait. Rapport bref, puis stop.

## Gestion des erreurs

- Test ou build en échec → lire uniquement les 30 dernières lignes
  (`... 2>&1 | tail -n 30`). Jamais le log complet.
- Si les 30 lignes ne suffisent pas à comprendre l'erreur, le dire
  explicitement plutôt que de relire tout le log.

## Format des messages (lecture mobile)

- Résumé en 1-2 phrases en tête de réponse.
- Étapes courtes, numérotées ou en liste à puces.
- Pas de pavés de texte, pas de sections inutiles.
- Aller droit à l'action ou au résultat.
