const db = require("../../db");

class AnalyticsRepository {
  /**
   * Enregistre un ǸvǸnement analytique.
   */
  // analytics_events est sous RLS FORCE : trackEvent() est appelé depuis de
  // très nombreux contextes (jobs cron, webhooks Stripe, routes sans
  // requireOrganisation) où aucun contexte ALS n'est garanti. Plutôt que de
  // dépendre de l'appelant, cette écriture ouvre sa propre connexion scopée.
  async insertEvent({ organisationId, userId, eventName, metadata = {} }) {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationId)]);
      const res = await client.query(
        `INSERT INTO analytics_events (organisation_id, user_id, event_name, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [organisationId, userId || null, eventName, metadata],
      );
      await client.query("COMMIT");
      return res.rows[0];
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new AnalyticsRepository();
