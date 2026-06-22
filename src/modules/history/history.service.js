const pool = require('../../../db');

class HistoryService {
    /**
     * Appends a new cognitive event and closes the previous one.
     */
    async appendEvent(userId, orgId, state, projectId, confidence) {
        // 1. Get last active event
        const lastEventRes = await pool.query(`
            SELECT id, state, projet_id, started_at 
            FROM cognitive_state_events 
            WHERE utilisateur_id = $1 AND ended_at IS NULL 
            ORDER BY started_at DESC LIMIT 1
        `, [userId]);

        const lastEvent = lastEventRes.rows[0];

        if (lastEvent) {
            // Idempotency check
            if (lastEvent.state === state && lastEvent.projet_id == projectId) {
                return { isUnchanged: true, event: lastEvent };
            }

            // Close old event
            const durationMinutes = Math.floor((new Date() - new Date(lastEvent.started_at)) / 60000);
            await pool.query(`
                UPDATE cognitive_state_events 
                SET ended_at = NOW(), duration_minutes = $1 
                WHERE id = $2
            `, [durationMinutes, lastEvent.id]);
        }

        // Insert new event
        const newEventRes = await pool.query(`
            INSERT INTO cognitive_state_events (utilisateur_id, organisation_id, state, started_at, projet_id, confidence) 
            VALUES ($1, $2, $3, NOW(), $4, $5) 
            RETURNING id, state, started_at, projet_id, confidence
        `, [userId, orgId, state, projectId || null, confidence || null]);

        return { isUnchanged: false, event: newEventRes.rows[0] };
    }

    async getDailyTimeline(userId, targetDate) {
        const eventsRes = await pool.query(`
            SELECT id, state, started_at, ended_at, duration_minutes, projet_id
            FROM cognitive_state_events
            WHERE utilisateur_id = $1 AND started_at::date = $2
            ORDER BY started_at ASC
        `, [userId, targetDate]);

        return eventsRes.rows;
    }
}

module.exports = new HistoryService();
