const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../../db');

/**
 * Crée une Stripe Checkout Session pour un add‑on.
 * @param {number} organisationId - ID de l'organisation.
 * @param {string} moduleKey - Clé du module (doit être un add‑on).
 * @returns {Promise<Object>} La session Stripe.
 */
async function createCheckoutSession(organisationId, moduleKey) {
  // Récupérer le prix du module depuis la table module_pricing
  const priceResult = await db.query(
    'SELECT price_cents, currency, description FROM module_pricing WHERE module_key = $1',
    [moduleKey]
  );
  if (priceResult.rowCount === 0) {
    throw new Error(`Pricing not found for module ${moduleKey}`);
  }
  const { price_cents, currency, description } = priceResult.rows[0];

  // Identifier le client Stripe (il faut le créer / synchroniser ailleurs, ici on utilise organisationId comme metadata)
  // Pour la simplicité, on n'utilise pas de Customer Stripe – on passe l'ID d'org en metadata.
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: currency,
          product_data: {
            name: description || moduleKey,
          },
          unit_amount: price_cents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    metadata: {
      organisation_id: organisationId.toString(),
      module_key: moduleKey,
    },
    // URLs de retour – adapter selon l'environnement de dev / prod
    success_url: `${process.env.FRONTEND_URL}/modules-and-subscription?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/modules-and-subscription`,
  });
  return session;
}

module.exports = { createCheckoutSession };
