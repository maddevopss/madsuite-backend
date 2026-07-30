# PRIORITÉ 2 — Inventaire du code Stripe réel

## Résumé exécutif

Après inspection du code Stripe réel dans le dépôt `maddevopss/madsuite-backend`, voici l'état actuel :

### Code Stripe existant

| Composant | Fichier | État |
|-----------|---------|------|
| Routes | `src/routes/stripe.routes.js` | ✅ Existe |
| Service principal | `src/services/stripe.service.js` | ✅ Existe |
| Réconciliation (v1) | `src/services/stripe-reconciliation.service.js` | ✅ Existe |
| Réconciliation (v2) | `src/services/stripeReconciliation.service.js` | ✅ Existe |
| Migrations | `db/migrations/033_stripe_subscriptions.sql` | ✅ Existe |
| Migrations | `db/migrations/035_invoice_payments.sql` | ✅ Existe |
| Migrations | `db/migrations/048_payment_events.sql` | ✅ Existe |
| Tests Stripe | `src/test/stripe*.test.js` | ❌ Aucun trouvé |

### Défauts critiques découverts

#### 1. **Table `stripe_webhook_events` manquante**
- **Code** : `src/services/stripe-reconciliation.service.js` ligne 31-48
- **Problème** : Le code tente d'insérer dans `stripe_webhook_events` mais la table n'existe pas en migration
- **Impact** : L'idempotence des webhooks échouerait en production
- **Sévérité** : CRITIQUE

#### 2. **Deux services de réconciliation incompatibles**
- **Code** : `stripe-reconciliation.service.js` vs `stripeReconciliation.service.js`
- **Problème** : Deux implémentations différentes, confusion sur laquelle utiliser
- **Impact** : Risque de traitement dupliqué ou manqué
- **Sévérité** : HAUTE

#### 3. **Pas de tests Stripe**
- **Code** : Aucun fichier `src/test/stripe*.test.js`
- **Problème** : Zéro couverture de test pour les scénarios critiques
- **Impact** : Impossible de valider la signature, l'idempotence, les paiements
- **Sévérité** : CRITIQUE

#### 4. **Signature webhook sans protection complète**
- **Code** : `src/routes/stripe.routes.js` ligne 11-37
- **Problème** : Signature validée mais pas de test pour signature invalide
- **Impact** : Impossible de prouver que les signatures invalides sont refusées
- **Sévérité** : HAUTE

#### 5. **Isolation multi-organisation non testée**
- **Code** : `src/services/stripeReconciliation.service.js` ligne 127-136
- **Problème** : Pas de test pour vérifier qu'un événement Stripe d'une org ne modifie pas une autre
- **Impact** : Risque de fuite de données entre organisations
- **Sévérité** : CRITIQUE

#### 6. **Gestion des événements hors ordre non implémentée**
- **Code** : `src/services/stripeReconciliation.service.js`
- **Problème** : Pas de vérification de `event.created` ou de timestamp
- **Impact** : Un événement obsolète pourrait revenir à un état antérieur
- **Sévérité** : HAUTE

#### 7. **Remboursements non supportés**
- **Code** : Aucune gestion de `charge.refunded` ou `charge.refund.updated`
- **Problème** : Les remboursements Stripe ne sont pas traités
- **Impact** : Les remboursements clients ne sont pas enregistrés
- **Sévérité** : MOYENNE

#### 8. **Abonnements : plan_type hardcodé**
- **Code** : `src/services/stripe-reconciliation.service.js` ligne 178
- **Problème** : `planType = "pro"` en dur, pas de lookup_key ou metadata
- **Impact** : Impossible de supporter plusieurs plans
- **Sévérité** : MOYENNE

### Matrice de couverture

| Scénario | Code | Test | Comportement | Correction |
|----------|------|------|--------------|-----------|
| Signature valide | ✅ | ❌ | Accepté | Ajouter test |
| Signature invalide | ✅ | ❌ | Refusé (supposé) | Ajouter test |
| Charge utile invalide | ✅ | ❌ | Refusé (supposé) | Ajouter test |
| Événement inconnu | ✅ | ❌ | Ignoré | Ajouter test |
| Événement dupliqué | ⚠️ | ❌ | Échouerait (table manquante) | Créer table + test |
| Événement hors ordre | ❌ | ❌ | Non géré | Implémenter + test |
| Paiement réussi | ✅ | ❌ | Facture marquée payée | Ajouter test |
| Paiement échoué | ⚠️ | ❌ | Audit enregistré | Ajouter test |
| Remboursement | ❌ | ❌ | Non supporté | Implémenter + test |
| Remboursement partiel | ❌ | ❌ | Non supporté | Implémenter + test |
| Abonnement créé | ✅ | ❌ | Plan appliqué | Ajouter test |
| Abonnement renouvelé | ✅ | ❌ | Statut mis à jour | Ajouter test |
| Abonnement annulé | ✅ | ❌ | Plan = free | Ajouter test |
| Abonnement réactivé | ❌ | ❌ | Non géré | Implémenter + test |
| Réconciliation | ✅ | ❌ | Abonnement + factures | Ajouter test |
| Panne Stripe | ❌ | ❌ | Non géré | Implémenter retry |
| Isolation par org | ⚠️ | ❌ | Supposée mais non testée | Ajouter test |

### Fichiers à créer/modifier

#### Créer (CRITIQUE)
1. `db/migrations/049_create_stripe_webhook_events.sql` — Table manquante
2. `src/test/stripe-webhook.security.test.js` — Tests signature
3. `src/test/stripe-idempotency.test.js` — Tests idempotence
4. `src/test/stripe-payments.test.js` — Tests paiements
5. `src/test/stripe-subscriptions.test.js` — Tests abonnements
6. `src/test/stripe-reconciliation.test.js` — Tests réconciliation
7. `src/test/stripe-multi-org.test.js` — Tests isolation

#### Modifier (HAUTE)
1. `src/services/stripe-reconciliation.service.js` — Ajouter gestion événements hors ordre
2. `src/services/stripeReconciliation.service.js` — Consolider avec v1 ou clarifier usage
3. `src/routes/stripe.routes.js` — Ajouter logging sécurisé

#### Documenter
1. `STRIPE_IMPLEMENTATION.md` — Architecture Stripe complète

---

## Prochaines étapes

1. **Créer la migration manquante** pour `stripe_webhook_events`
2. **Créer les tests critiques** (signature, idempotence, paiements)
3. **Implémenter la protection contre les événements hors ordre**
4. **Tester l'isolation multi-organisation**
5. **Exécuter la suite complète**
6. **Créer la PR**


