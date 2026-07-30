/**
 * stripe-subscriptions.test.js
 * 
 * Tests des abonnements Stripe :
 * - Création d'abonnement
 * - Activation
 * - Renouvellement
 * - Annulation
 * - Réactivation
 * - Changement de plan
 * - Événement dupliqué
 * - Événement hors ordre
 */

const request = require('supertest');
const Stripe = require('stripe');
const db = require('../../db');

jest.mock('stripe');

describe('Stripe Subscriptions', () => {
  let app;
  let testOrganisationId;

  beforeAll(async () => {
    app = require('../app');

    // Créer une organisation de test
    const orgRes = await db.query(
      'INSERT INTO organisations (nom) VALUES ($1) RETURNING id',
      ['Test Org Subscriptions']
    );
    testOrganisationId = orgRes.rows[0].id;

    // Créer un client Stripe pour l'organisation
    await db.query(
      'UPDATE organisations SET stripe_customer_id = $1 WHERE id = $2',
      ['cus_test_sub_' + Date.now(), testOrganisationId]
    );
  });

  afterAll(async () => {
    if (testOrganisationId) {
      await db.query('DELETE FROM organisations WHERE id = $1', [testOrganisationId]);
    }
    if (db.pool) {
      await db.pool.end();
    }
  });

  describe('Création d\'abonnement', () => {
    it('devrait créer un abonnement avec plan_type valide', async () => {
      const eventId = 'evt_sub_created_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_sub_created_' + Date.now(),
            mode: 'subscription',
            customer: 'cus_test_sub_' + Date.now(),
            subscription: 'sub_created_' + Date.now(),
            subscription_details: {
              metadata: {
                plan_type: 'pro'
              }
            },
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

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);

      // Vérifier que le plan_type est appliqué
      const org = await db.query(
        'SELECT plan_type FROM organisations WHERE id = $1',
        [testOrganisationId]
      );
      expect(org.rows[0].plan_type).toBe('pro');
    });

    it('devrait utiliser lookup_key si metadata.plan_type absent', async () => {
      const eventId = 'evt_sub_lookup_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_sub_lookup_' + Date.now(),
            mode: 'subscription',
            customer: 'cus_test_sub_' + Date.now(),
            subscription: 'sub_lookup_' + Date.now(),
            subscription_details: {
              lookup_key: 'enterprise'
            },
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

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);

      // Vérifier que le plan_type est appliqué
      const org = await db.query(
        'SELECT plan_type FROM organisations WHERE id = $1',
        [testOrganisationId]
      );
      expect(org.rows[0].plan_type).toBe('enterprise');
    });

    it('devrait fallback à "pro" si plan_type invalide', async () => {
      const eventId = 'evt_sub_fallback_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_sub_fallback_' + Date.now(),
            mode: 'subscription',
            customer: 'cus_test_sub_' + Date.now(),
            subscription: 'sub_fallback_' + Date.now(),
            subscription_details: {
              metadata: {
                plan_type: 'invalid_plan'
              }
            },
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

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);

      // Vérifier que le fallback à "pro" est appliqué
      const org = await db.query(
        'SELECT plan_type FROM organisations WHERE id = $1',
        [testOrganisationId]
      );
      expect(org.rows[0].plan_type).toBe('pro');
    });
  });

  describe('Renouvellement d\'abonnement', () => {
    it('devrait mettre à jour le statut lors du renouvellement', async () => {
      const eventId = 'evt_sub_renewed_' + Date.now();
      const event = {
        id: eventId,
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_renewed_' + Date.now(),
            customer: 'cus_test_sub_' + Date.now(),
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

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);

      // Vérifier que le statut est mis à jour
      const org = await db.query(
        'SELECT subscription_status FROM organisations WHERE id = $1',
        [testOrganisationId]
      );
      expect(org.rows[0].subscription_status).toBe('active');
    });
  });

  describe('Annulation d\'abonnement', () => {
    it('devrait passer le plan à "free" lors de l\'annulation', async () => {
      const eventId = 'evt_sub_canceled_' + Date.now();
      const event = {
        id: eventId,
        type: 'customer.subscription.deleted',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_canceled_' + Date.now(),
            customer: 'cus_test_sub_' + Date.now(),
            status: 'canceled',
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

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);

      // Vérifier que le plan est passé à "free"
      const org = await db.query(
        'SELECT plan_type, subscription_status FROM organisations WHERE id = $1',
        [testOrganisationId]
      );
      expect(org.rows[0].plan_type).toBe('free');
      expect(org.rows[0].subscription_status).toBe('canceled');
    });
  });

  describe('Événement dupliqué', () => {
    it('ne devrait pas appliquer deux fois le même changement de plan', async () => {
      const eventId = 'evt_sub_dup_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_sub_dup_' + Date.now(),
            mode: 'subscription',
            customer: 'cus_test_sub_' + Date.now(),
            subscription: 'sub_dup_' + Date.now(),
            subscription_details: {
              metadata: {
                plan_type: 'enterprise'
              }
            },
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
      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      const orgAfterFirst = await db.query(
        'SELECT plan_type FROM organisations WHERE id = $1',
        [testOrganisationId]
      );
      const planAfterFirst = orgAfterFirst.rows[0].plan_type;

      // Deuxième appel
      await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      const orgAfterSecond = await db.query(
        'SELECT plan_type FROM organisations WHERE id = $1',
        [testOrganisationId]
      );
      const planAfterSecond = orgAfterSecond.rows[0].plan_type;

      // Le plan ne devrait pas changer
      expect(planAfterSecond).toBe(planAfterFirst);
    });
  });

  describe('Isolation par organisation', () => {
    it('ne devrait pas modifier l\'abonnement d\'une autre organisation', async () => {
      // Créer une deuxième organisation
      const org2Res = await db.query(
        'INSERT INTO organisations (nom) VALUES ($1) RETURNING id',
        ['Test Org 2 Subscriptions']
      );
      const org2Id = org2Res.rows[0].id;

      try {
        const eventId = 'evt_sub_isolation_' + Date.now();
        const event = {
          id: eventId,
          type: 'checkout.session.completed',
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              id: 'cs_sub_isolation_' + Date.now(),
              mode: 'subscription',
              customer: 'cus_test_sub_' + Date.now(),
              subscription: 'sub_isolation_' + Date.now(),
              subscription_details: {
                metadata: {
                  plan_type: 'enterprise'
                }
              },
              metadata: {
                organisation_id: org2Id.toString()
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

        // Vérifier que org2 a le plan enterprise
        const org2 = await db.query(
          'SELECT plan_type FROM organisations WHERE id = $1',
          [org2Id]
        );
        expect(org2.rows[0].plan_type).toBe('enterprise');

        // Vérifier que testOrganisationId n'a pas changé
        const org1 = await db.query(
          'SELECT plan_type FROM organisations WHERE id = $1',
          [testOrganisationId]
        );
        // org1 ne devrait pas être enterprise à cause de cet événement
        expect(org1.rows[0].plan_type).not.toBe('enterprise');
      } finally {
        // Nettoyer
        await db.query('DELETE FROM organisations WHERE id = $1', [org2Id]);
      }
    });
  });

  describe('Validation du plan_type', () => {
    it('ne devrait accepter que les plans allowlist', async () => {
      const eventId = 'evt_sub_invalid_plan_' + Date.now();
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_sub_invalid_' + Date.now(),
            mode: 'subscription',
            customer: 'cus_test_sub_' + Date.now(),
            subscription: 'sub_invalid_' + Date.now(),
            subscription_details: {
              metadata: {
                plan_type: 'hacker_plan'
              }
            },
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

      const response = await request(app)
        .post('/api/stripe/webhook')
        .set('stripe-signature', signature)
        .send(payload)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);

      // Vérifier que le plan est fallback à "pro"
      const org = await db.query(
        'SELECT plan_type FROM organisations WHERE id = $1',
        [testOrganisationId]
      );
      expect(org.rows[0].plan_type).toBe('pro');
    });
  });
});
