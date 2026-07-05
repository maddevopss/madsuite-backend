## Résumé

Décrire le changement en quelques lignes.

## Type de changement

- [ ] Correction
- [ ] Feature
- [ ] Sécurité
- [ ] Refactor
- [ ] Tests / CI
- [ ] Documentation
- [ ] Dépendances

## Surface touchée

- [ ] Auth / sessions
- [ ] Organisation / RLS / multi-tenant
- [ ] Routes platform / super-admin
- [ ] Facturation / Stripe / ledger
- [ ] Jobs / cron / outbox
- [ ] IA / Cognitive Engine
- [ ] Migrations / DB
- [ ] Autre

## Validation locale

- [ ] `npm run guard:gitignore`
- [ ] `npm run guard:hygiene`
- [ ] `npm run guard:routes`
- [ ] `npm run guard:organisation-routes`
- [ ] `npm run lint`
- [ ] `npm test -- --runInBand`
- [ ] `npm run test:security -- --runInBand`

## MADPROOF

- [ ] Aucun secret réel ajouté
- [ ] Aucun `.env` réel ajouté
- [ ] Aucune route métier sans `requireOrganisation`
- [ ] Aucune route platform sensible sans super-admin
- [ ] Aucun claim médical / diagnostic / promesse clinique ajouté
- [ ] Logs vérifiés pour éviter token, cookie, secret ou donnée sensible inutile

## Notes de déploiement

Indiquer migrations, variables d’environnement, impacts production ou rollback requis.
