/**
 * stripe-webhook.idempotency.test.js
 * 
 * Tests d'idempotence pour les webhooks Stripe.
 * 
 * Vérifie que :
 * - Un même événement Stripe ne produit qu'un seul effet métier
 * - Les doublons séquentiels sont détectés et ignorés
 * - Les requêtes concurrentes avec le même event.id ne produisent qu'un seul effet
 * - Les événements différents sont traités séparément
 * - Les échecs peuvent être repris
 * - Les événements sans ID sont refusés
 * - Les événements en cours de traitement ne sont pas retraités
 */

const request = require('supertest');
const Stripe = require('stripe');
const db = require('../../db');
const crypto = require('crypto');

const TEST_STRIPE_KEY = 'sk_test_dummy_key_for_tests_only';
const TEST_WEBHOOK_SECRET = 'whsec_test_secret_12345';

// Créer une instance Stripe réelle AVANT le mock
const stripeForSigning = new Stripe(TEST_STRIPE_KEY);

function generateUniqueId() {
  return crypto.randomBytes(8).toString('hex');
}

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

  return { payload, signature };
}

describe('Stripe Webhook Idempotency', () => {
  let app;

  beforeAll(async () => {
    app = require('../app');
    // Réassigner stripeForSigning après le mock pour utiliser l'instance réelle
    // (elle a été créée avant le mock)
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = TEST_STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

    // Mock Stripe.webhooks.constructEvent pour accepter les signatures de test
    // Accepter TOUTES les signatures de test, pas seulement celles avec 'test_signature_'
    Stripe.webhooks = {
      constructEvent: jest.fn((body, sig, secret) => {
        // Accepter les signatures de test (commençant par t=)
        if (sig && sig.startsWith('t=')) {
          const bodyStr = typeof body === 'string' ? body : body.toString();
          return JSON.parse(bodyStr);
        }
        throw new Error('Invalid signature');
      }),
      generateTestHeaderString: jest.fn((opts) => {
        return `t=${Math.floor(Date.now() / 1000)},v1=test_signature_${opts.payload}`;
      }),
    };
  });

  afterEach(async () => {
    // Nettoyer les événements de test
    try {
      await db.query(
        `DELETE FROM stripe_webhook_events WHERE stripe_event_id LIKE 'evt_test_%'`
      );
    } catch (err) {
      // Ignorer les erreurs de nettoyage
    }
  });

  describe('Premier événement traité', () => {
    it('devrait traiter un événement valide une seule fois', async () => {
      const eventId = `evt_test_${Date.now()}_${generateUniqueId()}`;
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_test_123',
            payment_status: 'paid',
            amount_total: 2000,
            currency: 'cad',
            customer: 'cus_test_123',
            metadata: { organisation_id: '1' }
          }
        }
      };

      const { payload, signature } = createSignedPayload(event, TEST_WEBHOOK_SECRET);

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.received).toBe(true);

      // Vérifier que l'événement est enregistré en base
      const result = await db.query(
        `SELECT * FROM stripe_webhook_events WHERE stripe_event_id = $1`,
        [eventId]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].status).toBe('processed');
      expect(result.rows[0].attempts).toBe(1);
    });
  });

  describe('Doublon séquentiel', () => {
    it('devrait ignorer un doublon envoyé deux fois', async () => {
      const eventId = `evt_test_${Date.now()}_${generateUniqueId()}`;
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_test_456',
            payment_status: 'paid',
            amount_total: 3000,
            currency: 'cad',
            customer: 'cus_test_456',
            metadata: { organisation_id: '1' }
          }
        }
      };

      const { payload, signature } = createSignedPayload(event, TEST_WEBHOOK_SECRET);

      // Première requête
      const response1 = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response1.status).toBe(200);

      // Deuxième requête avec le même événement
      const response2 = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response2.status).toBe(200);
      expect(response2.body.duplicate).toBe(true);

      // Vérifier qu'une seule ligne existe en base
      const result = await db.query(
        `SELECT * FROM stripe_webhook_events WHERE stripe_event_id = $1`,
        [eventId]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].status).toBe('processed');
    });
  });

  describe('Requêtes concurrentes', () => {
    it('devrait gérer deux requêtes concurrentes avec le même event.id', async () => {
      const eventId = `evt_test_${Date.now()}_${generateUniqueId()}`;
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_test_789',
            payment_status: 'paid',
            amount_total: 4000,
            currency: 'cad',
            customer: 'cus_test_789',
            metadata: { organisation_id: '1' }
          }
        }
      };

      const { payload, signature } = createSignedPayload(event, TEST_WEBHOOK_SECRET);

      // Envoyer deux requêtes concurrentes
      const responses = await Promise.all([
        request(app)
          .post('/api/stripe/webhook')
          .set('stripe-signature', signature)
          .send(payload)
          .set('Content-Type', 'application/json'),
        request(app)
          .post('/api/stripe/webhook')
          .set('stripe-signature', signature)
          .send(payload)
          .set('Content-Type', 'application/json'),
      ]);

      // Les deux doivent réussir
      expect(responses[0].status).toBe(200);
      expect(responses[1].status).toBe(200);

      // Vérifier qu'une seule ligne existe en base
      const result = await db.query(
        `SELECT * FROM stripe_webhook_events WHERE stripe_event_id = $1`,
        [eventId]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].status).toBe('processed');
    });
  });

  describe('Événements différents', () => {
    it('devrait traiter deux événements différents séparément', async () => {
      const eventId1 = `evt_test_${Date.now()}_${generateUniqueId()}`;
      const eventId2 = `evt_test_${Date.now()}_${generateUniqueId()}`;

      const event1 = {
        id: eventId1,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'cs_1', customer: 'cus_1' } }
      };

      const event2 = {
        id: eventId2,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'cs_2', customer: 'cus_2' } }
      };

      const { payload: payload1, signature: sig1 } = createSignedPayload(event1, TEST_WEBHOOK_SECRET);
      const { payload: payload2, signature: sig2 } = createSignedPayload(event2, TEST_WEBHOOK_SECRET);

      const response1 = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', sig1)
        .send(payload1)
        .set('Content-Type', 'application/json');

      const response2 = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', sig2)
        .send(payload2)
        .set('Content-Type', 'application/json');

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // Vérifier que deux lignes existent en base
      const result = await db.query(
        `SELECT * FROM stripe_webhook_events WHERE stripe_event_id IN ($1, $2)`,
        [eventId1, eventId2]
      );

      expect(result.rows.length).toBe(2);
    });
  });

  describe('Événement sans ID', () => {
    it('devrait refuser un événement sans ID valide', async () => {
      const event = {
        id: '',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: { object: {} }
      };

      const { payload, signature } = createSignedPayload(event, TEST_WEBHOOK_SECRET);

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);

      // Vérifier qu'aucune ligne n'a été créée
      const result = await db.query(
        `SELECT * FROM stripe_webhook_events WHERE stripe_event_id = ''`
      );

      expect(result.rows.length).toBe(0);
    });
  });

  describe('Événement en cours de traitement', () => {
    it('devrait ignorer un événement déjà en cours de traitement', async () => {
      const eventId = `evt_test_${Date.now()}_${generateUniqueId()}`;

      // Préinsérer un événement en état 'processing'
      await db.query(
        `INSERT INTO stripe_webhook_events (stripe_event_id, event_type, status, attempts, processing_started_at)
         VALUES ($1, $2, 'processing', 1, NOW())`,
        [eventId, 'checkout.session.completed']
      );

      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'cs_test' } }
      };

      const { payload, signature } = createSignedPayload(event, TEST_WEBHOOK_SECRET);

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.duplicate).toBe(true);

      // Vérifier qu'une seule ligne existe et qu'elle est toujours en 'processing'
      const result = await db.query(
        `SELECT * FROM stripe_webhook_events WHERE stripe_event_id = $1`,
        [eventId]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].status).toBe('processing');
    });
  });

   describe('Reprise après échec', () => {
     it('devrait reprendre un événement échoué et incrémenter attempts', async () => {
       const eventId = `evt_test_${Date.now()}_${generateUniqueId()}`;
       const event = {
         id: eventId,
         type: 'checkout.session.completed',
         created: Math.floor(Date.now() / 1000),
         data: {
           object: {
             id: 'cs_test_failed',
             payment_status: 'paid',
             amount_total: 5000,
             currency: 'cad',
             customer: 'cus_test_failed',
             metadata: { organisation_id: '1' }
           }
         }
       };

       const { payload, signature } = createSignedPayload(event, TEST_WEBHOOK_SECRET);

       // Première livraison : provoquer un échec
       // Espionner le processeur métier pour le faire échouer une fois
       const stripeEventProcessor = require('../services/stripeEventProcessor.service');
       const originalProcessStripeEvent = stripeEventProcessor.processStripeEvent;

       let callCount = 0;
       jest.spyOn(stripeEventProcessor, 'processStripeEvent').mockImplementation(async (evt) => {
         callCount++;
         if (callCount === 1) {
           throw new Error('Controlled test failure for webhook processing');
         }
         // Deuxième appel : succès
         return originalProcessStripeEvent.call(stripeEventProcessor, evt);
       });

       // Première requête : doit échouer
       const response1 = await request(app)
         .post('/api/stripe/webhook')
         .set('stripe-signature', signature)
         .send(payload)
         .set('Content-Type', 'application/json');

       expect(response1.status).toBe(500);

       // Vérifier l'état en base après l'échec
       let result = await db.query(
         `SELECT status, attempts, processed_at, failed_at, last_error FROM stripe_webhook_events WHERE stripe_event_id = $1`,
         [eventId]
       );

       expect(result.rows.length).toBe(1);
       expect(result.rows[0].status).toBe('failed');
       expect(result.rows[0].attempts).toBe(1);
       expect(result.rows[0].processed_at).toBeNull();
       expect(result.rows[0].failed_at).not.toBeNull();
       expect(result.rows[0].last_error).toEqual(expect.any(String));

       // Deuxième livraison : doit réussir
       const response2 = await request(app)
         .post('/api/stripe/webhook')
         .set('stripe-signature', signature)
         .send(payload)
         .set('Content-Type', 'application/json');

       expect(response2.status).toBe(200);

       // Vérifier l'état final en base
       result = await db.query(
         `SELECT status, attempts, processed_at, failed_at, last_error FROM stripe_webhook_events WHERE stripe_event_id = $1`,
         [eventId]
       );

       expect(result.rows.length).toBe(1);
       expect(result.rows[0].status).toBe('processed');
       expect(result.rows[0].attempts).toBe(2);
       expect(result.rows[0].processed_at).not.toBeNull();
       expect(result.rows[0].failed_at).toBeNull();
       expect(result.rows[0].last_error).toBeNull();

       // Restaurer le mock
       stripeEventProcessor.processStripeEvent.mockRestore();
     });
   });
});
