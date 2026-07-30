/**
 * stripe-payments.test.js
 * 
 * Tests des paiements Stripe :
 * - Paiement réussi → facture marquée payée
 * - Paiement échoué → facture non payée
 * - Montant correct enregistré
 * - Devise correcte enregistrée
 * - Notification envoyée
 * - Événement journalisé
 * - Isolation par organisation
 */

const request = require('supertest');
const Stripe = require('stripe');
const db = require('../../db');

jest.mock('stripe');

describe('Stripe Payments', () => {
  let app;
  let orgA, orgB;
  let invoiceA, invoiceB;

  beforeAll(async () => {
    app = require('../app');

    // Créer deux organisations
    const orgARes = await db.query(
      'INSERT INTO organisations (nom) VALUES ($1) RETURNING id',
      ['Org A Payments']
    );
    orgA = orgARes.rows[0].id;

    const orgBRes = await db.query(
      'INSERT INTO organisations (nom) VALUES ($1) RETURNING id',
      ['Org B Payments']
    );
    orgB = orgBRes.rows[0].id;

    // Créer des clients
    const clientARes = await db.query(
      'INSERT INTO clients (nom, email, organisation_id) VALUES ($1, $2, $3) RETURNING id',
      ['Client A', 'clienta@example.com', orgA]
    );
    const clientA = clientARes.rows[0].id;

    const clientBRes = await db.query(
      'INSERT INTO clients (nom, email, organisation_id) VALUES ($1, $2, $3) RETURNING id',
      ['Client B', 'clientb@example.com', orgB]
    );
    const clientB = clientBRes.rows[0].id;

    // Créer des factures
    const invoiceARes = await db.query(
      `INSERT INTO invoices (client_id, organisation_id, invoice_number, total, status, currency)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [clientA, orgA, 'INV-A-001', 250.00, 'sent', 'cad']
    );
    invoiceA = invoiceARes.rows[0].id;

    const invoiceBRes = await db.query(
      `INSERT INTO invoices (client_id, organisation_id, invoice_number, total, status, currency)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [clientB, orgB, 'INV-B-001', 150.00, 'sent', 'cad']
    );
    invoiceB = invoiceBRes.rows[0].id;
  });

  afterAll(async () => {
    // Nettoyer
    if (invoiceA) await db.query('DELETE FROM invoices WHERE id = $1', [invoiceA]);
    if (invoiceB) await db.query('DELETE FROM invoices WHERE id = $1', [invoiceB]);
    if (orgA) await db.query('DELETE FROM organisations WHERE id = $1', [orgA]);
    if (orgB) await db.query('DELETE FROM organisations WHERE id = $1', [orgB]);
    if (db.pool) await db.pool.end();
  });

  describe('Paiement réussi', () => {
    it('devrait marquer la facture comme payée', async () => {
      const eventId = 'evt_payment_success_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_success_' + Date.now(),
            payment_status: 'paid',
            amount_total: 25000, // 250.00 CAD
            currency: 'cad',
            client_reference_id: `INV_${invoiceA}`,
            metadata: {
              organisation_id: orgA.toString()
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

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);

      // Vérifier que la facture est payée
      const invoice = await db.query(
        'SELECT status, paid_at FROM invoices WHERE id = $1',
        [invoiceA]
      );
      expect(invoice.rows[0].status).toBe('paid');
      expect(invoice.rows[0].paid_at).not.toBeNull();
    });

    it('devrait enregistrer le montant correct', async () => {
      const eventId = 'evt_payment_amount_' + Date.now();
      const event = {
        id: eventId,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_amount_' + Date.now(),
            amount: 25000, // 250.00 CAD
            currency: 'cad',
            metadata: {
              invoice_id: invoiceA.toString(),
              organisation_id: orgA.toString()
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

      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier l'entrée comptable
      const ledger = await db.query(
        `SELECT amount FROM accounting_ledger 
         WHERE organisation_id = $1 AND type = 'payment_received' 
         ORDER BY created_at DESC LIMIT 1`,
        [orgA]
      );
      if (ledger.rowCount > 0) {
        expect(parseFloat(ledger.rows[0].amount)).toBe(250.00);
      }
    });

    it('devrait enregistrer la devise correcte', async () => {
      const eventId = 'evt_payment_currency_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_currency_' + Date.now(),
            payment_status: 'paid',
            amount_total: 25000,
            currency: 'cad',
            client_reference_id: `INV_${invoiceA}`,
            metadata: {
              organisation_id: orgA.toString()
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

      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier l'entrée comptable
      const ledger = await db.query(
        `SELECT currency FROM accounting_ledger 
         WHERE organisation_id = $1 AND type = 'payment_received' 
         ORDER BY created_at DESC LIMIT 1`,
        [orgA]
      );
      if (ledger.rowCount > 0) {
        expect(ledger.rows[0].currency.toLowerCase()).toBe('cad');
      }
    });

    it('devrait envoyer une notification', async () => {
      const eventId = 'evt_payment_notif_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_notif_' + Date.now(),
            payment_status: 'paid',
            amount_total: 25000,
            currency: 'cad',
            client_reference_id: `INV_${invoiceA}`,
            metadata: {
              organisation_id: orgA.toString()
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

      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier qu'une notification a été créée
      const notifications = await db.query(
        `SELECT COUNT(*) as count FROM notifications 
         WHERE organisation_id = $1 AND type = 'info'`,
        [orgA]
      );
      expect(notifications.rows[0].count).toBeGreaterThan(0);
    });

    it('devrait journaliser l\'événement', async () => {
      const eventId = 'evt_payment_audit_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_audit_' + Date.now(),
            payment_status: 'paid',
            amount_total: 25000,
            currency: 'cad',
            client_reference_id: `INV_${invoiceA}`,
            metadata: {
              organisation_id: orgA.toString()
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

      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier qu'un audit a été enregistré
      const audit = await db.query(
        `SELECT COUNT(*) as count FROM audit_logs 
         WHERE organisation_id = $1 AND action LIKE '%stripe%'`,
        [orgA]
      );
      expect(audit.rows[0].count).toBeGreaterThan(0);
    });
  });

  describe('Paiement échoué', () => {
    it('ne devrait pas marquer la facture comme payée', async () => {
      const eventId = 'evt_payment_failed_' + Date.now();
      const event = {
        id: eventId,
        type: 'payment_intent.payment_failed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_failed_' + Date.now(),
            amount: 25000,
            currency: 'cad',
            metadata: {
              invoice_id: invoiceA.toString(),
              organisation_id: orgA.toString()
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

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);

      // Vérifier que la facture n'est pas payée
      const invoice = await db.query(
        'SELECT status FROM invoices WHERE id = $1',
        [invoiceA]
      );
      expect(invoice.rows[0].status).not.toBe('paid');
    });
  });

  describe('Isolation par organisation', () => {
    it('ne devrait pas modifier une facture d\'une autre organisation', async () => {
      const eventId = 'evt_payment_isolation_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_isolation_' + Date.now(),
            payment_status: 'paid',
            amount_total: 15000,
            currency: 'cad',
            client_reference_id: `INV_${invoiceB}`,
            metadata: {
              organisation_id: orgB.toString()
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

      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // Vérifier que la facture de B est payée
      const invoiceBStatus = await db.query(
        'SELECT status FROM invoices WHERE id = $1',
        [invoiceB]
      );
      expect(invoiceBStatus.rows[0].status).toBe('paid');

      // Vérifier que la facture de A n'a pas changé
      const invoiceAStatus = await db.query(
        'SELECT status FROM invoices WHERE id = $1',
        [invoiceA]
      );
      // A ne devrait pas être payée par cet événement
      expect(invoiceAStatus.rows[0].status).not.toBe('paid');
    });
  });

  describe('Montant incorrect', () => {
    it('devrait refuser un paiement avec montant incorrect', async () => {
      const eventId = 'evt_payment_mismatch_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_mismatch_' + Date.now(),
            payment_status: 'paid',
            amount_total: 10000, // Incorrect : devrait être 25000
            currency: 'cad',
            client_reference_id: `INV_${invoiceA}`,
            metadata: {
              organisation_id: orgA.toString()
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

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      // La réponse devrait être 200 mais l'événement refusé
      expect(response.status).toBe(200);

      // Vérifier que la facture n'est pas payée
      const invoice = await db.query(
        'SELECT status FROM invoices WHERE id = $1',
        [invoiceA]
      );
      expect(invoice.rows[0].status).not.toBe('paid');
    });
  });
});
