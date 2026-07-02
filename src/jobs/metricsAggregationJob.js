const db = require("../../db");

class MetricsAggregationJob {
  /**
   * Calcule les mǸtriques de funnel  partir de la table analytics_events.
   * Cette fonction aggrge les donnǸes sur une pǸriode spǸcifiǸe (30 jours par dǸfaut).
   */
  async calculateMetrics(days = 30) {
    const query = `
      WITH recent_events AS (
        SELECT organisation_id, event_name
        FROM analytics_events
        WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      ),
      counts AS (
        SELECT
          COUNT(*) FILTER (WHERE event_name = 'signup_completed') AS signups,
          COUNT(*) FILTER (WHERE event_name = 'onboarding_completed') AS onboarding_completed,
          COUNT(*) FILTER (WHERE event_name IN ('first_invoice_created', 'invoice_created')) AS first_invoice,
          COUNT(*) FILTER (WHERE event_name = 'checkout_started') AS checkout_started,
          COUNT(*) FILTER (WHERE event_name = 'subscription_active') AS subscription_active
        FROM recent_events
      )
      SELECT * FROM counts;
    `;

    const result = await db.query(query, [days]);
    const row = result.rows[0] || {
      signups: 0,
      onboarding_completed: 0,
      first_invoice: 0,
      checkout_started: 0,
      subscription_active: 0
    };

    const signups = parseInt(row.signups, 10);
    const onboarding = parseInt(row.onboarding_completed, 10);
    const firstInv = parseInt(row.first_invoice, 10);
    const checkout = parseInt(row.checkout_started, 10);
    const subs = parseInt(row.subscription_active, 10);

    const onboardingPct = signups > 0 ? Math.round((onboarding / signups) * 100) : 0;
    const firstInvPct = signups > 0 ? Math.round((firstInv / signups) * 100) : 0;
    const checkoutPct = firstInv > 0 ? Math.round((checkout / firstInv) * 100) : 0;
    const paidPct = signups > 0 ? Math.round((subs / signups) * 100) : 0;

    const ttfi = await this.calculateTimeToFirstInvoice(days);

    return {
      signups,
      onboarding_completed: onboarding,
      onboarding_pct: onboardingPct,
      first_invoice: firstInv,
      first_invoice_pct: firstInvPct,
      checkout_started: checkout,
      checkout_pct: checkoutPct,
      subscription_active: subs,
      paid_pct: paidPct,
      ttfi_minutes: Math.round((ttfi.avg_minutes || 0) * 10) / 10,
      ttfi_sample_size: ttfi.sample_size || 0
    };
  }

  /**
   * Compute average Time To First Invoice in minutes
   */
  async calculateTimeToFirstInvoice(days = 30) {
    const query = `
      SELECT 
        COALESCE(AVG(EXTRACT(EPOCH FROM (fi.first_invoice - sc.signup)) / 60), 0) AS avg_minutes,
        COUNT(*) AS sample_size
      FROM (
        SELECT organisation_id, MIN(created_at) AS signup
        FROM analytics_events
        WHERE event_name = 'signup_completed'
          AND created_at >= NOW() - INTERVAL '1 day' * $1
        GROUP BY organisation_id
      ) sc
      JOIN (
        SELECT organisation_id, MIN(created_at) AS first_invoice
        FROM analytics_events
        WHERE event_name IN ('first_invoice_created', 'invoice_created')
          AND created_at >= NOW() - INTERVAL '1 day' * $1
        GROUP BY organisation_id
      ) fi USING (organisation_id)
    `;

    const res = await db.query(query, [days]);
    return {
      avg_minutes: parseFloat(res.rows[0]?.avg_minutes || 0),
      sample_size: parseInt(res.rows[0]?.sample_size || 0, 10)
    };
  }

  async run() {
    // Dans le futur, ceci pourrait insǸrer dans une table mǸtriques aggrǸgǸes
    // Pour l'instant, on calcule  la volǸe
    return await this.calculateMetrics(30);
  }
}

module.exports = new MetricsAggregationJob();
