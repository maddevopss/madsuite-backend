const db = require("../../db");

class MetricsAggregationJob {
  /**
   * Calcule les mǸtriques de funnel  partir de la table analytics_events.
   * Cette fonction aggrge les donnǸes sur une pǸriode spǸcifiǸe (30 jours par dǸfaut).
   */
  async calculateMetrics(days = 30) {
    const query = `
      WITH recent_events AS (
        SELECT organisation_id, event_name, metadata
        FROM analytics_events
        WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      ),
      orgs_stats AS (
        SELECT 
          organisation_id,
          COUNT(*) FILTER (WHERE event_name = 'client_created') > 0 AS has_created_client,
          COUNT(*) FILTER (WHERE event_name = 'invoice_sent') > 0 AS has_sent_invoice,
          COUNT(*) FILTER (WHERE event_name = 'invoice_paid') > 0 AS has_paid_invoice,
          COUNT(*) FILTER (WHERE event_name = 'recurring_enabled') > 0 AS has_recurring
        FROM recent_events
        GROUP BY organisation_id
      ),
      totals AS (
        SELECT 
          COUNT(*) AS total_active_orgs,
          COUNT(*) FILTER (WHERE has_created_client) AS activated_orgs,
          COUNT(*) FILTER (WHERE has_sent_invoice) AS invoiced_orgs,
          COUNT(*) FILTER (WHERE has_paid_invoice) AS paid_orgs,
          COUNT(*) FILTER (WHERE has_recurring) AS recurring_orgs
        FROM orgs_stats
      ),
      quote_stats AS (
        SELECT 
          COUNT(*) FILTER (WHERE event_name = 'quote_accepted') AS total_accepted,
          COUNT(*) FILTER (WHERE event_name = 'quote_converted') AS total_converted
        FROM recent_events
      ),
      dunning_stats AS (
        SELECT 
          (metadata->>'invoiceId') AS invoice_id,
          MAX(CASE WHEN event_name = 'dunning_triggered' THEN 1 ELSE 0 END) AS was_dunned,
          MAX(CASE WHEN event_name = 'invoice_paid' THEN 1 ELSE 0 END) AS was_paid
        FROM recent_events
        WHERE event_name IN ('dunning_triggered', 'invoice_paid')
        GROUP BY metadata->>'invoiceId'
      ),
      dunning_agg AS (
        SELECT 
          COUNT(*) FILTER (WHERE was_dunned = 1) AS total_dunned,
          COUNT(*) FILTER (WHERE was_dunned = 1 AND was_paid = 1) AS paid_after_dunning
        FROM dunning_stats
      )
      SELECT 
        t.total_active_orgs,
        
        -- Activation Rate: Orgs who created a client / Total active orgs
        CASE WHEN t.total_active_orgs > 0 THEN ROUND((t.activated_orgs::numeric / t.total_active_orgs) * 100, 2) ELSE 0 END AS activation_rate,
        
        -- First Invoice Sent Rate: Orgs who sent an invoice / Orgs who created a client
        CASE WHEN t.activated_orgs > 0 THEN ROUND((t.invoiced_orgs::numeric / t.activated_orgs) * 100, 2) ELSE 0 END AS first_invoice_sent_rate,
        
        -- First Payment Rate: Orgs who received a payment / Orgs who sent an invoice
        CASE WHEN t.invoiced_orgs > 0 THEN ROUND((t.paid_orgs::numeric / t.invoiced_orgs) * 100, 2) ELSE 0 END AS first_payment_rate,
        
        -- Recurring Adoption Rate: Orgs using recurring / Orgs who received a payment
        CASE WHEN t.paid_orgs > 0 THEN ROUND((t.recurring_orgs::numeric / t.paid_orgs) * 100, 2) ELSE 0 END AS recurring_adoption_rate,
        
        -- Quote Conversion Rate: Quotes converted / Quotes accepted
        CASE WHEN q.total_accepted > 0 THEN ROUND((q.total_converted::numeric / q.total_accepted) * 100, 2) ELSE 0 END AS quote_conversion_rate,
        
        -- Invoice Paid After Dunning Rate
        CASE WHEN d.total_dunned > 0 THEN ROUND((d.paid_after_dunning::numeric / d.total_dunned) * 100, 2) ELSE 0 END AS invoice_paid_after_dunning_rate
        
      FROM totals t
      CROSS JOIN quote_stats q
      CROSS JOIN dunning_agg d;
    `;

    const result = await db.query(query, [days]);
    const row = result.rows[0];

    return {
      monthly_active_accounts: parseInt(row.total_active_orgs, 10),
      activation_rate: parseFloat(row.activation_rate),
      first_invoice_sent_rate: parseFloat(row.first_invoice_sent_rate),
      first_payment_rate: parseFloat(row.first_payment_rate),
      recurring_adoption_rate: parseFloat(row.recurring_adoption_rate),
      quote_conversion_rate: parseFloat(row.quote_conversion_rate),
      invoice_paid_after_dunning_rate: parseFloat(row.invoice_paid_after_dunning_rate)
    };
  }

  async run() {
    // Dans le futur, ceci pourrait insǸrer dans une table mǸtriques aggrǸgǸes
    // Pour l'instant, on calcule  la volǸe
    return await this.calculateMetrics(30);
  }
}

module.exports = new MetricsAggregationJob();
