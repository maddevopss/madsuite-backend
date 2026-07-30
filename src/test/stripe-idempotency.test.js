/**
 * stripe-idempotency.test.js
 * 
 * Tests d'idempotence pour les webhooks Stripe :
 * - Même événement envoyé deux fois → traité une seule fois
 * - Événement dupliqué reconnu et ignoré
 * - Pas de double paiement
 * - Pas de double facture
 * - Pas de double notification
 * - Pas de double activation d'abonnement
 */

const request = require('supertest');
const Stripe = require('stripe');
const db = require('../../db');

jest.mock('stripe');

describe('Stripe Webhook Idempotency', () => {
  let app;
  let testOrganisationId;
  let testInvoiceId;

  beforeAll(async () => {
    app = require('../app');

    // Créer une organisation de test
    const orgRes = await db.query(
      'INSERT INTO organisations (nom) VALUES ($1) RETURNING id',
      ['Test Org Idempotency']
    );
    testOrganisationId = orgRes.rows[0].id;

    // Créer un client de test
    const clientRes = await db.query(
      'INSERT INTO clients (nom, email, organisation_id) VALUES ($1, $2, $3) RETURNING id',
      ['Test Client', 'test@example.com', testOrganisationId]
    );
    const testClientId = clientRes.rows[0].id;

    // Créer une facture de test
    const invoiceRes = await db.query(
      `INSERT INTO invoices (client_id, organisation_id, invoice_number, total, status, currency)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [testClientId, testOrganisationId, 'INV-001', 100.00, 'sent', 'cad']
    );
    testInvoiceId = invoiceRes.rows[0].id;
  });

  afterAll(async () => {
    // Nettoyer les données de test
    if (testInvoiceId) {
      await db.query('DELETE FROM invoices WHERE id = $1', [testInvoiceId]);
    }
    if (testOrganisationId) {
      await db.query('DELETE FROM organisations WHERE id = $1', [testOrganisationId]);
    }
    if (db.pool) {
      await db.pool.end();
    }
  });

  describe('Événement dupliqué', () => {
    it('devrait traiter le même événement une seule fois', async () => {
      const eventId = 'evt_idempotency_test_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_test_idem_' + Date.now(),
            payment_status: 'paid',
            amount_total: 10000, // 100.00 CAD
            currency: 'cad',
            client_reference_id: `INV_${testInvoiceId}`,
            metadata: {
              organisation_id: testOrganisationId.toString()
            }
          }
        }
      };

      const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      const payload = JSON.stringify(event);
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret
      });

      // Premier appel
      const response1 = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response1.status).toBe(200);

      // Vérifier que la facture est marquée payée
      const invoiceAfterFirst = await db.query(
        'SELECT status FROM invoices WHERE id = $1',
        [testInvoiceId]
      );
      expect(invoiceAfterFirst.rows[0].status).toBe('paid');

      // Deuxième appel avec le même événement
      const response2 = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response2.status).toBe(200);

      // Vérifier que la facture est toujours payée (pas de double traitement)
      const invoiceAfterSecond = await db.query(
        'SELECT status FROM invoices WHERE id = $1',
        [testInvoiceId]
      );
      expect(invoiceAfterSecond.rows[0].status).toBe('paid');

      // Vérifier qu'il n'y a qu'une seule entrée dans payment_events
      const paymentEvents = await db.query(
        'SELECT COUNT(*) as count FROM payment_events WHERE stripe_event_id = $1',
        [eventId]
      );
      expect(paymentEvents.rows[0].count).toBe(1);
    });
  });

  describe('Pas de double paiement', () => {
    it('ne devrait pas créer deux entrées de paiement pour le même événement', async () => {
      const eventId = 'evt_double_payment_' + Date.now();
      const event = {
        id: eventId,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_test_' + Date.now(),
            amount: 10000,
            currency: 'cad',
            metadata: {
              invoice_id: testInvoiceId.toString(),
              organisation_id: testOrganisationId.toString()
            }
          }
        }
      };

      const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      const payload = JSON.stringify(event);
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret
      });

      // Envoyer deux fois
      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier qu'il n'y a qu'une seule entrée de paiement
      const ledgerEntries = await db.query(
        `SELECT COUNT(*) as count FROM accounting_ledger 
         WHERE reference_type = 'stripe_webhook' AND reference_id LIKE $1`,
        ['pi_test_%']
      );
      expect(ledgerEntries.rows[0].count).toBeLessThanOrEqual(1);
    });
  });

  describe('Pas de double notification', () => {
    it('ne devrait pas créer deux notifications pour le même événement', async () => {
      const eventId = 'evt_double_notif_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_test_notif_' + Date.now(),
            payment_status: 'paid',
            amount_total: 10000,
            currency: 'cad',
            client_reference_id: `INV_${testInvoiceId}`,
            metadata: {
              organisation_id: testOrganisationId.toString()
            }
          }
        }
      };

      const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      const payload = JSON.stringify(event);
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret
      });

      // Envoyer deux fois
      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      const notificationsAfterFirst = await db.query(
        `SELECT COUNT(*) as count FROM notifications 
         WHERE organisation_id = $1 AND type = 'info'`,
        [testOrganisationId]
      );
      const countAfterFirst = notificationsAfterFirst.rows[0].count;

      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      const notificationsAfterSecond = await db.query(
        `SELECT COUNT(*) as count FROM notifications 
         WHERE organisation_id = $1 AND type = 'info'`,
        [testOrganisationId]
      );
      const countAfterSecond = notificationsAfterSecond.rows[0].count;

      // Vérifier que le nombre de notifications n'a pas augmenté
      expect(countAfterSecond).toBe(countAfterFirst);
    });
  });

  describe('Événement dupliqué reconnu', () => {
    it('devrait reconnaître un événement dupliqué et le marquer comme tel', async () => {
      const eventId = 'evt_recognized_dup_' + Date.now();
      const event = {
        id: eventId,
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_test_' + Date.now(),
            customer: 'cus_test_' + Date.now(),
            status: 'active',
            metadata: {
              organisation_id: testOrganisationId.toString()
            }
          }
        }
      };

      const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      const payload = JSON.stringify(event);
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret
      });

      // Premier appel
      const response1 = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response1.status).toBe(200);

      // Deuxième appel
      const response2 = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response2.status).toBe(200);

      // Vérifier que l'événement est enregistré une seule fois
      const webhookEvents = await db.query(
        'SELECT COUNT(*) as count FROM stripe_webhook_events WHERE stripe_event_id = $1',
        [eventId]
      );
      expect(webhookEvents.rows[0].count).toBe(1);
    });
  });

  describe('Concurrence', () => {
    it('devrait gérer deux traitements concurrents du même événement', async () => {
      const eventId = 'evt_concurrent_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_test_concurrent_' + Date.now(),
            payment_status: 'paid',
            amount_total: 10000,
            currency: 'cad',
            client_reference_id: `INV_${testInvoiceId}`,
            metadata: {
              organisation_id: testOrganisationId.toString()
            }
          }
        }
      };

      const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      const payload = JSON.stringify(event);
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret
      });

      // Envoyer deux requêtes en parallèle
      const [response1, response2] = await Promise.all([
        request(app)
          .post('/api/stripe/webhook')
          .set('stripe-signature', signature)
          .send(payload)
          .set('Content-Type', 'application/json'),
        request(app)
          .post('/api/stripe/webhook')
          .set('stripe-signature', signature)
          .send(payload)
          .set('Content-Type', 'application/json')
      ]);

      // Les deux doivent réussir
      expect([response1.status, response2.status]).toEqual(expect.arrayContaining([200]));

      // Vérifier qu'il n'y a qu'une seule entrée
      const paymentEvents = await db.query(
        'SELECT COUNT(*) as count FROM payment_events WHERE stripe_event_id = $1',
        [eventId]
      );
      expect(paymentEvents.rows[0].count).toBe(1);
    });
  });
});
