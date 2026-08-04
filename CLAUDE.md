# CLAUDE.md — MADSuite Backend

Backend Node/Express + Prisma (Jest) de MADSuite App.

## ⚡ Règles strictes — Économie de tokens & Workflow mobile

Ces règles priment sur tout comportement par défaut de Claude Code sur ce repo.

### 1. Économie de tokens
- Réponses concises. Pas de blabla, pas de formules de politesse.
- Ne JAMAIS lancer `npm test` seul, `npm run check:backend`, `test:modules`, `test:security` ou `test:coverage` (suites complètes) pendant l'itération.
- Cibler uniquement les fichiers modifiés:
  - `cross-env NODE_ENV=test npx jest <chemin_du_fichier_test> --silent --detectOpenHandles --forceExit`
- Ne jamais relire tout un fichier volumineux ou tout le repo pour du contexte — grep/recherche ciblée sur les symboles concernés uniquement.
- Ne pas lancer les `guard:*` ni `lint` sauf si le changement touche routes/migrations, et cibler alors uniquement les fichiers modifiés.
- **Exception pré-push** (une seule fois, pas à chaque itération) : juste avant un push final, lancer `npm run test:security` (~20s) puis la suite Jest complète en arrière-plan. Si un échec autre que les 13 échecs Stripe pré-existants (connus) apparaît, ne pas pousser tant que non résolu.
  > ⚠️ **Compromis assumé** : ce repo est financier/RH/paie multi-tenant avec RLS. Ces règles désactivent volontairement les filets de sécurité habituels (suite complète, `test:security`) pour économiser des tokens en usage mobile. Des bugs réels n'ont déjà été trouvés que par la suite complète (ex: mauvais type de colonne bloquant 4 chemins d'écriture RH, double validation non bloquée) — sans ces runs, ce type de régression peut passer inaperçu jusqu'à la review humaine ou la prod. Accepté sciemment par l'utilisateur pour ce workflow, à revoir si des régressions silencieuses apparaissent.

### 2. Pas de polling
- Ne JAMAIS boucler en attente d'un résultat CI/CD après un `git push`.
- S'arrêter dès que le push est effectué. Ne pas surveiller le pipeline.

### 3. Gestion des erreurs
- Si un test/build échoue: lire uniquement les 30 dernières lignes du log/stack trace (`... 2>&1 | tail -n 30`).
- Ne jamais lire un log complet, même en cas d'échec répété. Si les 30 lignes ne suffisent pas à comprendre l'erreur, le dire explicitement plutôt que de relire tout le log.

### 4. Format mobile
- Résumés courts, étapes numérotées ou puces.
- Pas de longs paragraphes ni de gros blocs de code non essentiels.
