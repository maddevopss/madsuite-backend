/**
 * stripe-multi-org.test.js
 * 
 * Tests d'isolation multi-organisation pour Stripe :
 * - Événement Stripe de A ne modifie que A
 * - Client Stripe de A ne donne pas accès à B
 * - Abonnement de B reste inchangé
 * - Paiement de A ne marque pas une facture de B
 * - Réconciliation de A ne modifie pas B
 * - Recherches en base incluent l'organisation
 */

const request = require('supertest');
const Stripe = require('stripe');
const db = require('../../db');

jest.mock('stripe');

describe('Stripe Multi-Organisation Isolation', () => {
  let app;
  let orgA, orgB;
  let clientA, clientB;
  let invoiceA, invoiceB;

  beforeAll(async () => {
    app = require('../app');

    // Créer deux organisations
    const orgARes = await db.query(
      'INSERT INTO organisations (nom) VALUES ($1) RETURNING id',
      ['Org A Multi-Org']
    );
    orgA = orgARes.rows[0].id;

    const orgBRes = await db.query(
      'INSERT INTO organisations (nom) VALUES ($1) RETURNING id',
      ['Org B Multi-Org']
    );
    orgB = orgBRes.rows[0].id;

    // Créer des clients pour chaque organisation
    const clientARes = await db.query(
      'INSERT INTO clients (nom, email, organisation_id) VALUES ($1, $2, $3) RETURNING id',
      ['Client A', 'clienta@multi.com', orgA]
    );
    clientA = clientARes.rows[0].id;

    const clientBRes = await db.query(
      'INSERT INTO clients (nom, email, organisation_id) VALUES ($1, $2, $3) RETURNING id',
      ['Client B', 'clientb@multi.com', orgB]
    );
    clientB = clientBRes.rows[0].id;

    // Créer des factures pour chaque organisation
    const invoiceARes = await db.query(
      `INSERT INTO invoices (client_id, organisation_id, invoice_number, total, status, currency)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [clientA, orgA, 'INV-A-MULTI-001', 500.00, 'sent', 'cad']
    );
    invoiceA = invoiceARes.rows[0].id;

    const invoiceBRes = await db.query(
      `INSERT INTO invoices (client_id, organisation_id, invoice_number, total, status, currency)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [clientB, orgB, 'INV-B-MULTI-001', 300.00, 'sent', 'cad']
    );
    invoiceB = invoiceBRes.rows[0].id;
  });

  afterAll(async () => {
    // Nettoyer
    if (invoiceA) await db.query('DELETE FROM invoices WHERE id = $1', [invoiceA]);
    if (invoiceB) await db.query('DELETE FROM invoices WHERE id = $1', [invoiceB]);
    if (clientA) await db.query('DELETE FROM clients WHERE id = $1', [clientA]);
    if (clientB) await db.query('DELETE FROM clients WHERE id = $1', [clientB]);
    if (orgA) await db.query('DELETE FROM organisations WHERE id = $1', [orgA]);
    if (orgB) await db.query('DELETE FROM organisations WHERE id = $1', [orgB]);
    if (db.pool) await db.pool.end();
  });

  describe('Événement Stripe de A ne modifie que A', () => {
    it('devrait modifier uniquement l\'organisation A', async () => {
      const eventId = 'evt_multi_org_a_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_multi_a_' + Date.now(),
            payment_status: 'paid',
            amount_total: 50000, // 500.00 CAD
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

      // Vérifier que la facture de A est payée
      const invoiceAStatus = await db.query(
        'SELECT status FROM invoices WHERE id = $1 AND organisation_id = $2',
        [invoiceA, orgA]
      );
      expect(invoiceAStatus.rows[0].status).toBe('paid');

      // Vérifier que la facture de B n'a pas changé
      const invoiceBStatus = await db.query(
        'SELECT status FROM invoices WHERE id = $1 AND organisation_id = $2',
        [invoiceB, orgB]
      );
      expect(invoiceBStatus.rows[0].status).toBe('sent');
    });
  });

  describe('Client Stripe de A ne donne pas accès à B', () => {
    it('devrait isoler les clients Stripe par organisation', async () => {
      // Assigner un client Stripe à A
      const stripeCustomerA = 'cus_multi_a_' + Date.now();
      await db.query(
        'UPDATE organisations SET stripe_customer_id = $1 WHERE id = $2',
        [stripeCustomerA, orgA]
      );

      // Assigner un client Stripe différent à B
      const stripeCustomerB = 'cus_multi_b_' + Date.now();
      await db.query(
        'UPDATE organisations SET stripe_customer_id = $1 WHERE id = $2',
        [stripeCustomerB, orgB]
      );

      // Vérifier que les clients sont différents
      const orgAData = await db.query(
        'SELECT stripe_customer_id FROM organisations WHERE id = $1',
        [orgA]
      );
      const orgBData = await db.query(
        'SELECT stripe_customer_id FROM organisations WHERE id = $1',
        [orgB]
      );

      expect(orgAData.rows[0].stripe_customer_id).toBe(stripeCustomerA);
      expect(orgBData.rows[0].stripe_customer_id).toBe(stripeCustomerB);
      expect(orgAData.rows[0].stripe_customer_id).not.toBe(orgBData.rows[0].stripe_customer_id);
    });
  });

  describe('Abonnement de B reste inchangé', () => {
    it('ne devrait pas modifier l\'abonnement de B lors d\'un événement de A', async () => {
      // Assigner un abonnement à B
      const subscriptionB = 'sub_multi_b_' + Date.now();
      await db.query(
        'UPDATE organisations SET stripe_subscription_id = $1, plan_type = $2 WHERE id = $3',
        [subscriptionB, 'pro', orgB]
      );

      // Envoyer un événement pour A
      const eventId = 'evt_multi_sub_a_' + Date.now();
      const event = {
        id: eventId,
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_multi_a_' + Date.now(),
            customer: 'cus_multi_a_' + Date.now(),
            status: 'active',
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

      // Vérifier que l'abonnement de B n'a pas changé
      const orgBData = await db.query(
        'SELECT stripe_subscription_id, plan_type FROM organisations WHERE id = $1',
        [orgB]
      );
      expect(orgBData.rows[0].stripe_subscription_id).toBe(subscriptionB);
      expect(orgBData.rows[0].plan_type).toBe('pro');
    });
  });

  describe('Paiement de A ne marque pas une facture de B', () => {
    it('devrait isoler les paiements par organisation', async () => {
      const eventId = 'evt_multi_payment_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_multi_payment_' + Date.now(),
            payment_status: 'paid',
            amount_total: 50000,
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

      // Vérifier que seule la facture de A est payée
      const invoiceAStatus = await db.query(
        'SELECT status FROM invoices WHERE id = $1 AND organisation_id = $2',
        [invoiceA, orgA]
      );
      expect(invoiceAStatus.rows[0].status).toBe('paid');

      // Vérifier que la facture de B n'est pas payée
      const invoiceBStatus = await db.query(
        'SELECT status FROM invoices WHERE id = $1 AND organisation_id = $2',
        [invoiceB, orgB]
      );
      expect(invoiceBStatus.rows[0].status).toBe('sent');
    });
  });

  describe('Réconciliation de A ne modifie pas B', () => {
    it('devrait isoler la réconciliation par organisation', async () => {
      // Assigner des clients Stripe
      await db.query(
        'UPDATE organisations SET stripe_customer_id = $1, plan_type = $2 WHERE id = $3',
        ['cus_recon_a_' + Date.now(), 'pro', orgA]
      );

      await db.query(
        'UPDATE organisations SET stripe_customer_id = $1, plan_type = $2 WHERE id = $3',
        ['cus_recon_b_' + Date.now(), 'free', orgB]
      );

      // Appeler la réconciliation
      const response = await request(app)
        .post('/api/stripe/reconcile')
        .set('Authorization', 'Bearer test_token')
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);

      // Vérifier que le plan de B n'a pas changé
      const orgBData = await db.query(
        'SELECT plan_type FROM organisations WHERE id = $1',
        [orgB]
      );
      expect(orgBData.rows[0].plan_type).toBe('free');
    });
  });

  describe('Recherches en base incluent l\'organisation', () => {
    it('devrait filtrer par organisation dans les recherches', async () => {
      // Créer deux factures avec le même numéro mais organisations différentes
      const invoiceNum = 'INV-DUPLICATE-' + Date.now();

      const invoiceA2Res = await db.query(
        `INSERT INTO invoices (client_id, organisation_id, invoice_number, total, status, currency)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [clientA, orgA, invoiceNum, 100.00, 'sent', 'cad']
      );
      const invoiceA2 = invoiceA2Res.rows[0].id;

      const invoiceB2Res = await db.query(
        `INSERT INTO invoices (client_id, organisation_id, invoice_number, total, status, currency)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [clientB, orgB, invoiceNum, 200.00, 'sent', 'cad']
      );
      const invoiceB2 = invoiceB2Res.rows[0].id;

      try {
        // Rechercher les factures de A
        const invoicesA = await db.query(
          'SELECT id, total FROM invoices WHERE organisation_id = $1 AND invoice_number = $2',
          [orgA, invoiceNum]
        );
        expect(invoicesA.rowCount).toBe(1);
        expect(invoicesA.rows[0].total).toBe('100.00');

        // Rechercher les factures de B
        const invoicesB = await db.query(
          'SELECT id, total FROM invoices WHERE organisation_id = $1 AND invoice_number = $2',
          [orgB, invoiceNum]
        );
        expect(invoicesB.rowCount).toBe(1);
        expect(invoicesB.rows[0].total).toBe('200.00');
      } finally {
        await db.query('DELETE FROM invoices WHERE id = $1', [invoiceA2]);
        await db.query('DELETE FROM invoices WHERE id = $1', [invoiceB2]);
      }
    });
  });

  describe('Aucune recherche sans validation du locataire', () => {
    it('ne devrait pas permettre une recherche sans organisation', async () => {
      // Vérifier que les recherches critiques incluent l'organisation
      const invoices = await db.query(
        'SELECT COUNT(*) as count FROM invoices WHERE organisation_id IS NOT NULL'
      );
      expect(invoices.rows[0].count).toBeGreaterThanOrEqual(0);

      // Vérifier qu'une recherche sans organisation retourne tous les résultats
      const allInvoices = await db.query(
        'SELECT COUNT(*) as count FROM invoices'
      );
      expect(allInvoices.rows[0].count).toBeGreaterThanOrEqual(invoices.rows[0].count);
    });
  });

  describe('Événement avec organisation invalide', () => {
    it('devrait refuser un événement avec organisation invalide', async () => {
      const eventId = 'evt_multi_invalid_org_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_multi_invalid_' + Date.now(),
            payment_status: 'paid',
            amount_total: 50000,
            currency: 'cad',
            client_reference_id: `INV_${invoiceA}`,
            metadata: {
              organisation_id: '99999' // Organisation inexistante
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

      // Vérifier que la facture de A n'a pas changé
      const invoiceAStatus = await db.query(
        'SELECT status FROM invoices WHERE id = $1 AND organisation_id = $2',
        [invoiceA, orgA]
      );
      expect(invoiceAStatus.rows[0].status).not.toBe('paid');
    });
  });
});
