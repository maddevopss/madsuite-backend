const db = require("../../db");

class AnalyticsRepository {
  /**
   * Enregistre un ǸvǸnement analytique.
   */
  async insertEvent({ organisationId, userId, eventName, metadata = {} }) {
    const query = `
      INSERT INTO analytics_events (organisation_id, user_id, event_name, metadata)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const values = [organisationId, userId || null, eventName, metadata];
    const res = await db.query(query, values);
    return res.rows[0];
  }
}

module.exports = new AnalyticsRepository();
