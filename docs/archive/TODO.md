# TODO - test harness (priorité)

- [ ] Rendre `src/test/setupOrganisationDefaults.js` robuste: attendre que la DB de test soit ready (retry/backoff) avant `ensureOrganisationDefaults()`.
- [ ] Relancer `cd backend && npm test -- --runInBand`.
- [ ] Si échecs restants: corriger migrations/seed manquants (relations/colonnes) ou erreurs RLS.
