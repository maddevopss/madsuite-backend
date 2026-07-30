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

// Mock Stripe pour les tests
jest.mock('stripe');

describe('Stripe Webhook Security', () => {
  let app;
  let stripeInstance;

  beforeAll(async () => {
    // Charger l'app
    app = require('../app');
  });

  beforeEach(() => {
    // Réinitialiser les mocks
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Fermer les connexions
    if (db.pool) {
      await db.pool.end();
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

      // Signer l'événement avec la clé secrète
      const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      const payload = JSON.stringify(event);
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret
      });

      // Envoyer le webhook
      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier que la réponse est 200
      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);
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
      expect(response.text).toContain('Webhook Error');
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

        // Vérifier que la réponse est 400 ou 500
        expect([400, 500]).toContain(response.status);
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

      const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      const payload = JSON.stringify(event);
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret
      });

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier que la réponse est 200 (événement ignoré)
      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);
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
