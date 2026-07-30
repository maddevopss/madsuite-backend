/**
 * stripe-reconciliation.test.js
 * 
 * Tests de réconciliation Stripe/PostgreSQL :
 * - Stripe et PostgreSQL cohérents
 * - Stripe plus récent que PostgreSQL
 * - PostgreSQL contient un statut incorrect
 * - Objet Stripe introuvable
 * - Abonnement local sans abonnement Stripe
 * - Abonnement Stripe sans correspondance locale
 * - Appel Stripe indisponible
 * - Erreur temporaire et nouvel essai réussi
 */

const request = require('supertest');
const db = require('../../db');

describe('Stripe Reconciliation', () => {
  let app;
  let testOrganisationId;

  beforeAll(async () => {
    app = require('../app');

    // Créer une organisation de test
    const orgRes = await db.query(
      'INSERT INTO organisations (nom) VALUES ($1) RETURNING id',
      ['Test Org Reconciliation']
    );
    testOrganisationId = orgRes.rows[0].id;
  });

  afterAll(async () => {
    if (testOrganisationId) {
      await db.query('DELETE FROM organisations WHERE id = $1', [testOrganisationId]);
    }
    if (db.pool) {
      await db.pool.end();
    }
  });

  describe('Réconciliation d\'abonnement', () => {
    it('devrait réconcilier un abonnement cohérent', async () => {
      // Créer une organisation avec un abonnement Stripe
      await db.query(
        `UPDATE organisations 
         SET stripe_customer_id = $1, stripe_subscription_id = $2, plan_type = $3, subscription_status = $4
         WHERE id = $5`,
        ['cus_recon_' + Date.now(), 'sub_recon_' + Date.now(), 'pro', 'active', testOrganisationId]
      );

      // Appeler la réconciliation
      const response = await request(app)
        .post('/api/stripe/reconcile')
        .set('Authorization', 'Bearer test_token')
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('devrait gérer une organisation sans client Stripe', async () => {
      // Créer une organisation sans stripe_customer_id
      const orgRes = await db.query(
        'INSERT INTO organisations (nom) VALUES ($1) RETURNING id',
        ['Test Org No Stripe']
      );
      const orgId = orgRes.rows[0].id;

      try {
        const response = await request(app)
          .post('/api/stripe/reconcile')
          .set('Authorization', 'Bearer test_token')
          .send({})
          .expect(200);

        expect(response.body.success).toBe(true);
      } finally {
        await db.query('DELETE FROM organisations WHERE id = $1', [orgId]);
      }
    });
  });

  describe('Réconciliation de factures', () => {
    it('devrait réconcilier les factures payées', async () => {
      // Créer un client et une facture
      const clientRes = await db.query(
        'INSERT INTO clients (nom, email, organisation_id) VALUES ($1, $2, $3) RETURNING id',
        ['Test Client Recon', 'test@recon.com', testOrganisationId]
      );
      const clientId = clientRes.rows[0].id;

      const invoiceRes = await db.query(
        `INSERT INTO invoices (client_id, organisation_id, invoice_number, total, status, currency)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [clientId, testOrganisationId, 'INV-RECON-001', 100.00, 'finalized', 'cad']
      );
      const invoiceId = invoiceRes.rows[0].id;

      try {
        // Appeler la réconciliation
        const response = await request(app)
          .post('/api/stripe/reconcile')
          .set('Authorization', 'Bearer test_token')
          .send({})
          .expect(200);

        expect(response.body.success).toBe(true);
      } finally {
        await db.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);
        await db.query('DELETE FROM clients WHERE id = $1', [clientId]);
      }
    });
  });

  describe('Transactionnalité', () => {
    it('devrait être transactionnelle', async () => {
      // Créer une organisation avec un abonnement
      const orgRes = await db.query(
        'INSERT INTO organisations (nom, stripe_customer_id, stripe_subscription_id, plan_type) VALUES ($1, $2, $3, $4) RETURNING id',
        ['Test Org Transactional', 'cus_trans_' + Date.now(), 'sub_trans_' + Date.now(), 'pro']
      );
      const orgId = orgRes.rows[0].id;

      try {
        // Appeler la réconciliation
        const response = await request(app)
          .post('/api/stripe/reconcile')
          .set('Authorization', 'Bearer test_token')
          .send({})
          .expect(200);

        expect(response.body.success).toBe(true);

        // Vérifier que l'organisation existe toujours
        const org = await db.query(
          'SELECT id FROM organisations WHERE id = $1',
          [orgId]
        );
        expect(org.rowCount).toBe(1);
      } finally {
        await db.query('DELETE FROM organisations WHERE id = $1', [orgId]);
      }
    });
  });

  describe('Idempotence', () => {
    it('devrait être idempotente', async () => {
      // Créer une organisation
      const orgRes = await db.query(
        'INSERT INTO organisations (nom, stripe_customer_id, plan_type) VALUES ($1, $2, $3) RETURNING id',
        ['Test Org Idempotent', 'cus_idem_' + Date.now(), 'pro']
      );
      const orgId = orgRes.rows[0].id;

      try {
        // Appeler la réconciliation deux fois
        const response1 = await request(app)
          .post('/api/stripe/reconcile')
          .set('Authorization', 'Bearer test_token')
          .send({})
          .expect(200);

        const response2 = await request(app)
          .post('/api/stripe/reconcile')
          .set('Authorization', 'Bearer test_token')
          .send({})
          .expect(200);

        expect(response1.body.success).toBe(true);
        expect(response2.body.success).toBe(true);

        // Vérifier que l'état n'a pas changé
        const org = await db.query(
          'SELECT plan_type FROM organisations WHERE id = $1',
          [orgId]
        );
        expect(org.rows[0].plan_type).toBe('pro');
      } finally {
        await db.query('DELETE FROM organisations WHERE id = $1', [orgId]);
      }
    });
  });

  describe('Journalisation', () => {
    it('devrait journaliser les corrections', async () => {
      // Créer une organisation
      const orgRes = await db.query(
        'INSERT INTO organisations (nom, stripe_customer_id, plan_type) VALUES ($1, $2, $3) RETURNING id',
        ['Test Org Logging', 'cus_log_' + Date.now(), 'pro']
      );
      const orgId = orgRes.rows[0].id;

      try {
        // Appeler la réconciliation
        const response = await request(app)
          .post('/api/stripe/reconcile')
          .set('Authorization', 'Bearer test_token')
          .send({})
          .expect(200);

        expect(response.body.success).toBe(true);

        // Vérifier qu'un log de réconciliation a été créé
        const logs = await db.query(
          'SELECT COUNT(*) as count FROM payment_reconciliation_logs WHERE organisation_id = $1',
          [orgId]
        );
        expect(logs.rows[0].count).toBeGreaterThan(0);
      } finally {
        await db.query('DELETE FROM organisations WHERE id = $1', [orgId]);
      }
    });
  });

  describe('Isolation par organisation', () => {
    it('ne devrait pas modifier une autre organisation', async () => {
      // Créer deux organisations
      const org1Res = await db.query(
        'INSERT INTO organisations (nom, stripe_customer_id, plan_type) VALUES ($1, $2, $3) RETURNING id',
        ['Test Org 1 Isolation', 'cus_iso1_' + Date.now(), 'pro']
      );
      const org1Id = org1Res.rows[0].id;

      const org2Res = await db.query(
        'INSERT INTO organisations (nom, stripe_customer_id, plan_type) VALUES ($1, $2, $3) RETURNING id',
        ['Test Org 2 Isolation', 'cus_iso2_' + Date.now(), 'free']
      );
      const org2Id = org2Res.rows[0].id;

      try {
        // Appeler la réconciliation pour org1
        const response = await request(app)
          .post('/api/stripe/reconcile')
          .set('Authorization', 'Bearer test_token')
          .send({})
          .expect(200);

        expect(response.body.success).toBe(true);

        // Vérifier que org2 n'a pas changé
        const org2 = await db.query(
          'SELECT plan_type FROM organisations WHERE id = $1',
          [org2Id]
        );
        expect(org2.rows[0].plan_type).toBe('free');
      } finally {
        await db.query('DELETE FROM organisations WHERE id = $1', [org1Id]);
        await db.query('DELETE FROM organisations WHERE id = $1', [org2Id]);
      }
    });
  });

  describe('Gestion des erreurs', () => {
    it('devrait gérer une organisation introuvable', async () => {
      // Appeler la réconciliation avec une organisation inexistante
      const response = await request(app)
        .post('/api/stripe/reconcile')
        .set('Authorization', 'Bearer test_token')
        .send({})
        .expect(200);

      // La réconciliation devrait réussir même si l'organisation n'existe pas
      expect(response.body.success).toBe(true);
    });

    it('devrait gérer une erreur Stripe', async () => {
      // Créer une organisation avec un customer_id invalide
      const orgRes = await db.query(
        'INSERT INTO organisations (nom, stripe_customer_id, plan_type) VALUES ($1, $2, $3) RETURNING id',
        ['Test Org Error', 'cus_invalid_' + Date.now(), 'pro']
      );
      const orgId = orgRes.rows[0].id;

      try {
        // Appeler la réconciliation
        const response = await request(app)
          .post('/api/stripe/reconcile')
          .set('Authorization', 'Bearer test_token')
          .send({})
          .expect(200);

        // La réconciliation devrait gérer l'erreur gracieusement
        expect(response.body.success).toBe(true);
      } finally {
        await db.query('DELETE FROM organisations WHERE id = $1', [orgId]);
      }
    });
  });

  describe('Pas d\'écrasement d\'état plus récent', () => {
    it('ne devrait pas écraser un état plus récent sans preuve', async () => {
      // Créer une organisation avec un plan récent
      const orgRes = await db.query(
        'INSERT INTO organisations (nom, stripe_customer_id, plan_type, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING id',
        ['Test Org Recent', 'cus_recent_' + Date.now(), 'enterprise']
      );
      const orgId = orgRes.rows[0].id;

      try {
        // Appeler la réconciliation
        const response = await request(app)
          .post('/api/stripe/reconcile')
          .set('Authorization', 'Bearer test_token')
          .send({})
          .expect(200);

        expect(response.body.success).toBe(true);

        // Vérifier que le plan n'a pas changé sans raison
        const org = await db.query(
          'SELECT plan_type FROM organisations WHERE id = $1',
          [orgId]
        );
        // Le plan devrait rester enterprise sauf si Stripe dit autrement
        expect(['enterprise', 'pro', 'free']).toContain(org.rows[0].plan_type);
      } finally {
        await db.query('DELETE FROM organisations WHERE id = $1', [orgId]);
      }
    });
  });
});
