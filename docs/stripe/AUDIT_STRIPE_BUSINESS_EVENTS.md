# AUDIT — TRAITEMENT MÉTIER DES ÉVÉNEMENTS STRIPE

## État initial

- Branche : `test/stripe-critical-scenarios`
- HEAD : `f1b9130b25c1914638d9080f68b838637a6646de`
- État : Propre

## 1. Matrice des événements trouvés

| Événement Stripe | Handler actuel | Tables modifiées | Org résolue | Plan résolu | Statut local | Tests existants | Risque |
|---|---|---|---|---|---|---|---|
| `checkout.session.completed` (subscription) | `stripe.service.js` | organisations | stripe_customer_id | resolvePlanTypeFromStripeSubscription | active | stripe-webhook.idempotency.test.js, stripe-subscriptions.test.js | ⚠️ Métadonnées non validées |
| `checkout.session.completed` (payment) | `stripe.service.js` | invoices, ledger, audit | client_reference_id | N/A | paid | stripe-payments.test.js | ⚠️ Montant validé mais pas de transaction |
| `customer.subscription.updated` | `stripe.service.js` | organisations | stripe_customer_id | N/A | subscription_status | stripe-webhook.idempotency.test.js | ⚠️ Pas de gestion des changements de plan |
| `customer.subscription.deleted` | `stripe.service.js` | organisations | stripe_customer_id | "free" | canceled | stripe-subscriptions.test.js | ✓ Sûr |
| `payment_intent.succeeded` | `stripeReconciliation.service.js` | invoices, ledger, audit, notifications | invoice.organisation_id | N/A | paid | stripeReconciliation.*.test.js | ✓ Transactionnel |
| `charge.succeeded` | `stripeReconciliation.service.js` | invoices, ledger, audit, notifications | invoice.organisation_id | N/A | paid | stripeReconciliation.*.test.js | ✓ Transactionnel |
| `invoice.payment_succeeded` | `stripeReconciliation.service.js` | invoices, ledger, audit, notifications | invoice.organisation_id | N/A | paid | stripeReconciliation.*.test.js | ✓ Transactionnel |
| `payment_intent.payment_failed` | `stripeReconciliation.service.js` | audit | invoice.organisation_id | N/A | unchanged | stripeReconciliation.*.test.js | ✓ Sûr |
| `charge.failed` | `stripeReconciliation.service.js` | audit | invoice.organisation_id | N/A | unchanged | stripeReconciliation.*.test.js | ✓ Sûr |
| `invoice.payment_failed` | `stripeReconciliation.service.js` | audit | invoice.organisation_id | N/A | unchanged | stripeReconciliation.*.test.js | ✓ Sûr |

## 2. Événements réellement supportés

### Abonnements (subscription mode)

- ✅ `checkout.session.completed` — Activation d'abonnement
- ✅ `customer.subscription.updated` — Mise à jour du statut
- ✅ `customer.subscription.deleted` — Annulation

### Paiements (payment mode)

- ✅ `checkout.session.completed` — Paiement de facture
- ✅ `payment_intent.succeeded` — Succès de paiement
- ✅ `charge.succeeded` — Succès de charge
- ✅ `invoice.payment_succeeded` — Succès de facture

### Échecs

- ✅ `payment_intent.payment_failed` — Échec de paiement
- ✅ `charge.failed` — Échec de charge
- ✅ `invoice.payment_failed` — Échec de facture

### Non supportés

- ❌ `customer.subscription.created` — Pas de handler
- ❌ `customer.subscription.trial_will_end` — Pas de handler
- ❌ `charge.refunded` — Pas de handler
- ❌ `refund.created` — Pas de handler

## 3. Processeur métier actuel

### Architecture

**Deux chemins parallèles :**

1. **`stripe.service.js::handleWebhook()`** — Abonnements et paiements directs
   - Pas de transaction
   - Pas de validation d'organisation stricte
   - Métadonnées acceptées sans vérification locale

2. **`stripeReconciliation.service.js::processWebhookEvent()`** — Paiements de factures
   - Transactionnel (BEGIN/COMMIT/ROLLBACK)
   - Validation stricte (montant, devise)
   - Idempotence via `payment_events` table

### Problèmes identifiés

#### 🔴 CRITIQUE

1. **Pas de transaction pour `checkout.session.completed` (subscription)**
   - Risque : Organisation modifiée sans plan cohérent
   - Correction : Ajouter transaction

2. **Métadonnées non validées pour organisation**
   - Risque : Injection d'organisation via `session.metadata.organisation_id`
   - Correction : Valider contre `stripe_customer_id` local

3. **Pas de validation du plan inconnu**
   - Risque : Plan inconnu → fallback "pro" silencieux
   - Correction : Erreur explicite ou repli sûr documenté

#### 🟡 IMPORTANT

4. **`customer.subscription.updated` ne gère pas les changements de plan**
   - Risque : Plan local non synchronisé
   - Correction : Ajouter `resolvePlanTypeFromStripeSubscription()`

5. **Pas de protection contre les événements hors ordre**
   - Risque : Événement ancien remplace état récent
   - Correction : Ajouter `event.created` check si nécessaire

6. **Pas de contrainte UNIQUE sur `stripe_subscription_id`**
   - Risque : Doublon local possible
   - Correction : Ajouter migration

#### 🟢 ACCEPTABLE

7. **Paiements directs (`checkout.session.completed` payment mode) sans transaction**
   - Raison : Montant validé, organisation via invoice
   - Risque faible : Ledger et audit peuvent être rejoués

## 4. Transactions ajoutées

### Nécessaires

```sql
-- checkout.session.completed (subscription)
BEGIN
  SELECT organisation WHERE stripe_customer_id = $1 FOR UPDATE
  UPDATE organisations SET plan_type, subscription_status, stripe_subscription_id
  INSERT INTO business_audit_logs
COMMIT
```

### Déjà présentes

```sql
-- payment_intent.succeeded, charge.succeeded, invoice.payment_succeeded
BEGIN
  INSERT INTO payment_events (idempotence)
  SELECT invoice FOR UPDATE
  UPDATE invoices SET status = 'paid'
  UPDATE time_entries SET is_billed = TRUE
  INSERT INTO ledger_entries
  INSERT INTO business_audit_logs
  INSERT INTO notifications
COMMIT
```

## 5. Stratégie de résolution de l'organisation

### Ordre recommandé (implémenté)

1. **Retrouver par `stripe_customer_id` local** ✅
   - `SELECT id FROM organisations WHERE stripe_customer_id = $1`
   - Source de vérité

2. **Utiliser métadonnées uniquement si aucun lien local** ⚠️
   - Actuellement : Accepté sans vérification
   - Correction : Vérifier cohérence

3. **Vérifier que l'organisation existe** ✅
   - Implicite via FK

4. **Refuser tout conflit** ⚠️
   - Actuellement : Pas de vérification
   - Correction : Ajouter check

### Implémentation proposée

```js
async function resolveOrganisationFromEvent(event) {
  const customerId = event.data.object.customer;
  
  // 1. Retrouver par stripe_customer_id
  const localOrg = await db.query(
    "SELECT id FROM organisations WHERE stripe_customer_id = $1",
    [customerId]
  );
  
  if (localOrg.rows[0]) {
    return localOrg.rows[0].id;
  }
  
  // 2. Utiliser métadonnées si aucun lien local
  const metaOrgId = event.data.object.metadata?.organisation_id;
  if (metaOrgId) {
    const metaOrg = await db.query(
      "SELECT id FROM organisations WHERE id = $1",
      [metaOrgId]
    );
    if (metaOrg.rows[0]) {
      return metaOrg.rows[0].id;
    }
  }
  
  throw new Error(`Organisation not found for customer ${customerId}`);
}
```

## 6. Stratégie de résolution du plan

### Ordre implémenté

1. **`metadata.plan_type`** ✅
2. **`lookup_key`** ✅
3. **Fallback "pro"** ✅

### Problème

- Fallback silencieux vers "pro" pour plan inconnu
- Pas de log explicite

### Correction proposée

```js
function resolvePlanTypeFromStripeSubscription(subscription) {
  const ALLOWED_PLANS = new Set(["pro", "enterprise"]);
  
  // 1. metadata.plan_type
  if (subscription?.metadata?.plan_type) {
    const plan = String(subscription.metadata.plan_type).toLowerCase();
    if (ALLOWED_PLANS.has(plan)) return plan;
    logger.warn("Unknown plan in metadata", { plan });
  }
  
  // 2. lookup_key
  if (subscription?.lookup_key) {
    const plan = String(subscription.lookup_key).toLowerCase();
    if (ALLOWED_PLANS.has(plan)) return plan;
    logger.warn("Unknown plan in lookup_key", { plan });
  }
  
  // 3. Fallback sûr
  logger.info("Using default plan 'pro'");
  return "pro";
}
```

## 7. Protections multitenant

### Implémentées

- ✅ `stripe_customer_id` → organisation unique
- ✅ `invoice.organisation_id` → isolation
- ✅ Transactions avec `FOR UPDATE`

### À ajouter

- ⚠️ Validation de cohérence métadonnées ↔ local
- ⚠️ Test de croisement multitenant

## 8. Comportements critiques

### `checkout.session.completed` (subscription)

**Flux actuel :**
1. Récupérer `stripe_customer_id` de la session
2. Retrouver organisation locale
3. Résoudre plan
4. Appeler `applyStripePlanUpdate()`
5. Tracker événement

**Problèmes :**
- Pas de transaction
- Pas de validation du plan
- Métadonnées non vérifiées

**Correction :**
- Ajouter transaction
- Valider plan avant UPDATE
- Vérifier cohérence organisation

### `customer.subscription.updated`

**Flux actuel :**
1. Récupérer `stripe_customer_id`
2. UPDATE `subscription_status` uniquement

**Problèmes :**
- Ne gère pas changement de plan
- Pas de transaction
- Pas de validation

**Correction :**
- Ajouter résolution de plan
- Ajouter transaction
- Mettre à jour `plan_type` si changé

### `customer.subscription.deleted`

**Flux actuel :**
1. Récupérer `stripe_customer_id`
2. Appeler `applyStripePlanUpdate()` avec `plan_type = "free"`

**Statut :** ✅ Sûr

### `invoice.paid` (via reconciliation)

**Flux actuel :**
1. Extraire `invoice_id` de métadonnées
2. Retrouver facture et organisation
3. Valider montant et devise
4. UPDATE facture
5. UPDATE time_entries
6. Insérer ledger et audit
7. Créer notification

**Statut :** ✅ Transactionnel et sûr

### `invoice.payment_failed`

**Flux actuel :**
1. Enregistrer audit
2. Retourner statut

**Statut :** ✅ Sûr

## 9. Migrations nécessaires

### Existantes

- ✅ `049_create_stripe_webhook_events.sql` — Idempotence
- ✅ `033_stripe_subscriptions.sql` — Colonnes Stripe
- ✅ `048_payment_events.sql` — Idempotence paiements

### À créer

```sql
-- Ajouter contrainte UNIQUE sur stripe_subscription_id
ALTER TABLE organisations
ADD CONSTRAINT unique_stripe_subscription_id 
UNIQUE (stripe_subscription_id) 
WHERE stripe_subscription_id IS NOT NULL;

-- Ajouter colonne pour protection événements hors ordre (optionnel)
ALTER TABLE organisations
ADD COLUMN last_stripe_event_created_at TIMESTAMPTZ;
```

## 10. Résumé des défauts

| Défaut | Sévérité | Correction | Effort |
|---|---|---|---|
| Pas de transaction `checkout.session.completed` | 🔴 | Ajouter BEGIN/COMMIT | Faible |
| Métadonnées non validées | 🔴 | Vérifier cohérence | Faible |
| Plan inconnu → "pro" silencieux | 🟡 | Ajouter log | Très faible |
| `subscription.updated` ne gère pas plan | 🟡 | Ajouter résolution | Faible |
| Pas de UNIQUE sur `stripe_subscription_id` | 🟡 | Migration | Très faible |
| Pas de protection événements hors ordre | 🟢 | Optionnel | Moyen |

## 11. Recommandations

### Phase 1 (Critique)

1. ✅ Ajouter transaction à `checkout.session.completed`
2. ✅ Valider cohérence organisation
3. ✅ Ajouter UNIQUE sur `stripe_subscription_id`

### Phase 2 (Important)

4. ✅ Gérer changement de plan dans `subscription.updated`
5. ✅ Ajouter logs explicites pour plans inconnus

### Phase 3 (Optionnel)

6. ⏳ Ajouter protection événements hors ordre
7. ⏳ Créer suite de tests métier complète

## Conclusion

**État actuel :** Fonctionnel mais avec risques de cohérence

**Risques principaux :**
- Pas de transaction pour abonnements
- Métadonnées non validées
- Pas de gestion des changements de plan

**Prochaines étapes :**
1. Créer `stripeEventProcessor.service.js` consolidé
2. Ajouter transactions
3. Ajouter validations
4. Créer suite de tests métier
