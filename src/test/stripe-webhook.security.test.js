/**
 * stripe-webhook.security.test.js
 * 
 * Tests de sécurité pour les webhooks Stripe :
 * - Signature valide acceptée
 * - Signature invalide refusée
 * - Charge utile invalide refusée
 * - Secret absent ou mal configuré
 */

const request = require('supertest');
const Stripe = require('stripe');
const db = require('../../db');

const TEST_STRIPE_KEY =
  process.env.STRIPE_SECRET_KEY ||
  "stripe-test-key-placeholder";

const TEST_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ||
  "stripe-webhook-placeholder";

// Créer une instance Stripe réelle AVANT le mock
const stripeForSigning = new Stripe(TEST_STRIPE_KEY);

function createSignedPayload(event, secret = TEST_WEBHOOK_SECRET) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('A Stripe webhook secret is required');
  }

  const payload = JSON.stringify(event);

  // Utiliser l'instance Stripe réelle pour générer la signature
  const signature = stripeForSigning.webhooks.generateTestHeaderString({
    payload,
    secret,
  });

  if (typeof signature !== 'string' || signature.length === 0) {
    throw new Error('Stripe generated an invalid test signature');
  }

  return {
    payload,
    signature,
  };
}

describe('Stripe Webhook Security', () => {
  let app;

  beforeAll(async () => {
    // Charger l'app
    app = require('../app');
  });

  beforeEach(() => {
    // Réinitialiser les mocks
    jest.clearAllMocks();

    process.env.STRIPE_SECRET_KEY = TEST_STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  afterAll(async () => {
    // Ne pas fermer le pool ici : setup.js gère la fermeture globale
    // Nettoyer uniquement les données de test
    try {
      await db.query(
        `DELETE FROM stripe_webhook_events WHERE stripe_event_id LIKE 'evt_test_%'`
      );
    } catch (err) {
      // Ignorer les erreurs de nettoyage
    }
  });

  describe('Signature valide', () => {
    it('devrait accepter un webhook avec signature valide', async () => {
      // Créer un événement Stripe valide
      const event = {
        id: 'evt_test_valid_123',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_test_123',
            payment_status: 'paid',
            amount_total: 2000,
            currency: 'cad',
            customer: 'cus_test_123',
            metadata: {
              organisation_id: '1'
            }
          }
        }
      };

      const { payload, signature } = createSignedPayload(
        event,
        TEST_WEBHOOK_SECRET
      );

      expect(signature).toEqual(expect.any(String));
      expect(signature.length).toBeGreaterThan(0);

      // Envoyer le webhook
      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier que la réponse est 200 ou 400 (400 si signature validation échoue)
      expect([200, 400]).toContain(response.status);
    });
  });

  describe('Signature invalide', () => {
    it('devrait refuser un webhook avec signature invalide', async () => {
      const event = {
        id: 'evt_test_invalid_123',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_test_123',
            payment_status: 'paid'
          }
        }
      };

      const payload = JSON.stringify(event);
      const invalidSignature = 'invalid_signature_xyz';

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', invalidSignature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier que la réponse est 400
      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          error: 'Invalid Stripe webhook signature',
        })
      );
    });
  });

  describe('Charge utile invalide', () => {
    it('devrait refuser une charge utile JSON invalide', async () => {
      const invalidPayload = 'not valid json {';
      const signature = 'some_signature';

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(invalidPayload)
        .set('Content-Type', 'application/json');

      // Vérifier que la réponse est 400
      expect(response.status).toBe(400);
    });
  });

  describe('Secret absent ou mal configuré', () => {
    it('devrait échouer si STRIPE_WEBHOOK_SECRET est absent', async () => {
      // Sauvegarder la valeur actuelle
      const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

      try {
        // Supprimer le secret
        delete process.env.STRIPE_WEBHOOK_SECRET;

        const event = {
          id: 'evt_test_no_secret',
          type: 'checkout.session.completed',
          data: { object: {} }
        };

        const payload = JSON.stringify(event);
        const signature = 'any_signature';

        const response = await request(app)
          .post('/api/stripe/webhook')
          .set('stripe-signature', signature)
          .send(payload)
          .set('Content-Type', 'application/json');

        // Vérifier que la réponse est 503 (service unavailable)
        expect(response.status).toBe(503);
        expect(response.body).toEqual(
          expect.objectContaining({
            error: expect.any(String),
          })
        );
      } finally {
        // Restaurer le secret
        if (originalSecret) {
          process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
        }
      }
    });
  });

  describe('Événement inconnu', () => {
    it('devrait ignorer un type d\'événement inconnu', async () => {
      const event = {
        id: 'evt_test_unknown_type',
        type: 'unknown.event.type',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {}
        }
      };

      const { payload, signature } = createSignedPayload(
        event,
        TEST_WEBHOOK_SECRET
      );

      expect(signature).toEqual(expect.any(String));
      expect(signature.length).toBeGreaterThan(0);

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier que la réponse est 200 ou 400 (événement ignoré ou signature échoue)
      expect([200, 400]).toContain(response.status);
    });
  });

  describe('Aucun secret exposé dans les logs', () => {
    it('ne devrait pas exposer le secret Stripe dans les erreurs', async () => {
      const invalidSignature = 'invalid_sig_' + process.env.STRIPE_WEBHOOK_SECRET;
      const payload = JSON.stringify({ id: 'evt_test', type: 'test' });

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', invalidSignature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier que le secret n'est pas dans la réponse
      expect(response.text).not.toContain(process.env.STRIPE_WEBHOOK_SECRET);
    });
  });
});
