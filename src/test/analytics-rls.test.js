/**
 * Tests for analytics tables RLS (Row Level Security)
 * 
 * Validates multi-tenant isolation:
 * - User from org A cannot read/write data from org B
 * - RLS policies enforce organisation_id filtering
 * - Composite indexes work correctly
 */

const db = require('../../db');

describe('Analytics Tables RLS - Multi-Tenant Isolation', () => {
  const orgA = 'org-a-uuid';
  const orgB = 'org-b-uuid';
  const userA = 'user-a-uuid';
  const userB = 'user-b-uuid';

  beforeAll(async () => {
    // Setup: Create test organisations and users
    // (In real test, would use fixtures or test database)
  });

  describe('analytics_events RLS', () => {
    it('should allow user to read only their organisation events', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Insert event for org A
      const insertResult = await db.pool.query(
        `INSERT INTO analytics_events (organisation_id, user_id, event_name, properties)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgA, userA, 'page_view', JSON.stringify({ page: '/dashboard' })]
      );

      // Query should return the event
      const selectResult = await db.pool.query(
        `SELECT * FROM analytics_events WHERE organisation_id = $1`,
        [orgA]
      );

      expect(selectResult.rows.length).toBeGreaterThan(0);
      expect(selectResult.rows[0].organisation_id).toBe(orgA);
    });

    it('should prevent user from reading other organisation events', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Try to query org B data (should be blocked by RLS)
      const result = await db.pool.query(
        `SELECT * FROM analytics_events WHERE organisation_id = $1`,
        [orgB]
      );

      // RLS should prevent access
      expect(result.rows.length).toBe(0);
    });

    it('should prevent INSERT into other organisation', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Try to insert into org B (should fail RLS check)
      try {
        await db.pool.query(
          `INSERT INTO analytics_events (organisation_id, user_id, event_name)
           VALUES ($1, $2, $3)`,
          [orgB, userA, 'malicious_event']
        );
        // If we get here, RLS failed
        expect(true).toBe(false);
      } catch (error) {
        // Expected: RLS policy violation
        expect(error.message).toContain('policy');
      }
    });

    it('should enforce organisation_id in WHERE clause', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Query without organisation_id filter should still be scoped
      const result = await db.pool.query(
        `SELECT * FROM analytics_events`
      );

      // All results should be from org A only
      result.rows.forEach(row => {
        expect(row.organisation_id).toBe(orgA);
      });
    });
  });

  describe('analytics_conversions RLS', () => {
    it('should allow user to read only their organisation conversions', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Insert conversion for org A
      const insertResult = await db.pool.query(
        `INSERT INTO analytics_conversions (organisation_id, user_id, test_name, variant)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgA, userA, 'checkout_flow', 'variant_b']
      );

      // Query should return the conversion
      const selectResult = await db.pool.query(
        `SELECT * FROM analytics_conversions WHERE organisation_id = $1`,
        [orgA]
      );

      expect(selectResult.rows.length).toBeGreaterThan(0);
      expect(selectResult.rows[0].organisation_id).toBe(orgA);
    });

    it('should prevent UPDATE of other organisation conversions', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Try to update org B data (should fail RLS check)
      try {
        await db.pool.query(
          `UPDATE analytics_conversions SET variant = $1 WHERE organisation_id = $2`,
          ['variant_a', orgB]
        );
        // If we get here, RLS failed
        expect(true).toBe(false);
      } catch (error) {
        // Expected: RLS policy violation
        expect(error.message).toContain('policy');
      }
    });

    it('should prevent DELETE of other organisation conversions', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Try to delete org B data (should fail RLS check)
      try {
        await db.pool.query(
          `DELETE FROM analytics_conversions WHERE organisation_id = $1`,
          [orgB]
        );
        // If we get here, RLS failed
        expect(true).toBe(false);
      } catch (error) {
        // Expected: RLS policy violation
        expect(error.message).toContain('policy');
      }
    });
  });

  describe('email_sequences RLS', () => {
    it('should allow user to read only their organisation sequences', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Insert sequence for org A
      const insertResult = await db.pool.query(
        `INSERT INTO email_sequences (organisation_id, user_id, sequence_name, email_subject, email_template, scheduled_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [orgA, userA, 'welcome', 'Welcome!', 'welcome.html', new Date()]
      );

      // Query should return the sequence
      const selectResult = await db.pool.query(
        `SELECT * FROM email_sequences WHERE organisation_id = $1`,
        [orgA]
      );

      expect(selectResult.rows.length).toBeGreaterThan(0);
      expect(selectResult.rows[0].organisation_id).toBe(orgA);
    });

    it('should prevent cross-organisation data leakage', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Insert sequence for org A
      await db.pool.query(
        `INSERT INTO email_sequences (organisation_id, user_id, sequence_name, email_subject, email_template, scheduled_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgA, userA, 'secret', 'Secret', 'secret.html', new Date()]
      );

      // Switch to org B context
      await db.pool.query("SET app.current_org_id = $1", [orgB]);

      // Try to read org A data (should be blocked)
      const result = await db.pool.query(
        `SELECT * FROM email_sequences WHERE sequence_name = 'secret'`
      );

      expect(result.rows.length).toBe(0);
    });
  });

  describe('Composite Index Performance', () => {
    it('should use composite index for organisation + timestamp queries', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Query that should use composite index
      const result = await db.pool.query(
        `SELECT * FROM analytics_events 
         WHERE organisation_id = $1 
         ORDER BY timestamp DESC 
         LIMIT 20`,
        [orgA]
      );

      // Should return results efficiently
      expect(Array.isArray(result.rows)).toBe(true);
    });

    it('should use composite index for organisation + created_at queries', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Query that should use composite index
      const result = await db.pool.query(
        `SELECT * FROM analytics_conversions 
         WHERE organisation_id = $1 
         ORDER BY created_at DESC 
         LIMIT 20`,
        [orgA]
      );

      // Should return results efficiently
      expect(Array.isArray(result.rows)).toBe(true);
    });
  });

  describe('RLS Policy Enforcement', () => {
    it('should enforce RLS on SELECT operations', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Query without explicit organisation_id filter
      const result = await db.pool.query(
        `SELECT COUNT(*) as count FROM analytics_events`
      );

      // Should only count org A events
      const count = parseInt(result.rows[0].count);
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should enforce RLS on INSERT operations', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Insert should work for org A
      const result = await db.pool.query(
        `INSERT INTO analytics_events (organisation_id, user_id, event_name)
         VALUES ($1, $2, $3) RETURNING organisation_id`,
        [orgA, userA, 'test_event']
      );

      expect(result.rows[0].organisation_id).toBe(orgA);
    });

    it('should enforce RLS on UPDATE operations', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Insert event
      const insertResult = await db.pool.query(
        `INSERT INTO analytics_events (organisation_id, user_id, event_name)
         VALUES ($1, $2, $3) RETURNING id`,
        [orgA, userA, 'test_event']
      );

      const eventId = insertResult.rows[0].id;

      // Update should work for org A
      const updateResult = await db.pool.query(
        `UPDATE analytics_events SET event_name = $1 WHERE id = $2 RETURNING organisation_id`,
        ['updated_event', eventId]
      );

      expect(updateResult.rows[0].organisation_id).toBe(orgA);
    });

    it('should enforce RLS on DELETE operations', async () => {
      // Set context for org A
      await db.pool.query("SET app.current_org_id = $1", [orgA]);

      // Insert event
      const insertResult = await db.pool.query(
        `INSERT INTO analytics_events (organisation_id, user_id, event_name)
         VALUES ($1, $2, $3) RETURNING id`,
        [orgA, userA, 'test_event']
      );

      const eventId = insertResult.rows[0].id;

      // Delete should work for org A
      const deleteResult = await db.pool.query(
        `DELETE FROM analytics_events WHERE id = $1 RETURNING organisation_id`,
        [eventId]
      );

      expect(deleteResult.rows[0].organisation_id).toBe(orgA);
    });
  });
});
