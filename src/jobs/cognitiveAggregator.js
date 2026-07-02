const pool = require('../../db');

async function aggregateCognitiveMetrics() {
    // FIX P1 (audit multi-tenant 2026-06-24) :
    // La requête originale récupérait TOUS les événements sans filtre organisation_id.
    // On itère maintenant par organisation pour garantir l'isolation multi-tenant.
    const logger = require('../config/logger');
    logger.info('[CognitiveAggregator] Démarrage de l\'agrégation quotidienne...');
    try {
        // Obtenir la date d'hier (pour agréger la journée complète)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const targetDateStr = yesterday.toISOString().split('T')[0];

        // Récupérer les organisations actives — isolation multi-tenant
        const orgsRes = await pool.query(`SELECT id FROM organisations WHERE deleted_at IS NULL`);
        let totalUsersAggregated = 0;

        for (const org of orgsRes.rows) {
            const organisationId = org.id;

            // Filtre strict par organisation_id — évite toute fuite cross-tenant
            const eventsRes = await pool.query(`
                SELECT utilisateur_id, organisation_id, state, duration_minutes, projet_id
                FROM cognitive_state_events
                WHERE started_at::date = $1 AND organisation_id = $2
            `, [targetDateStr, organisationId]);

            const events = eventsRes.rows;
            if (events.length === 0) continue;

            // Grouper par utilisateur (dans le scope de cette organisation uniquement)
            const userStats = {};
            for (const ev of events) {
                const uid = ev.utilisateur_id;
                if (!userStats[uid]) {
                    userStats[uid] = {
                        organisation_id: organisationId, // Toujours l'org courante
                        flow: 0,
                        deep_focus: 0,
                        friction: 0,
                        fatigue: 0,
                        longest_session: 0,
                        projects: {} // { projet_id: totalMinutes }
                    };
                }

                const minutes = ev.duration_minutes || 0;
                const state = ev.state;

                if (userStats[uid][state] !== undefined) {
                    userStats[uid][state] += minutes;
                }

                if (state === 'deep_focus') {
                    if (minutes > userStats[uid].longest_session) {
                        userStats[uid].longest_session = minutes;
                    }
                    if (ev.projet_id) {
                        userStats[uid].projects[ev.projet_id] = (userStats[uid].projects[ev.projet_id] || 0) + minutes;
                    }
                }
            }

            // Insérer les résultats dans daily_cognitive_metrics
            for (const [uidStr, stats] of Object.entries(userStats)) {
                const uid = parseInt(uidStr, 10);
                
                // Trouver le projet dominant (celui avec le plus de minutes de deep_focus)
                let dominantProjectId = null;
                let maxProjMinutes = 0;
                for (const [pidStr, mins] of Object.entries(stats.projects)) {
                    if (mins > maxProjMinutes) {
                        maxProjMinutes = mins;
                        dominantProjectId = parseInt(pidStr, 10);
                    }
                }

                const totalFocus = stats.flow + stats.deep_focus;

                // ON CONFLICT sur (utilisateur_id, organisation_id, date) — migration 061
                // Garantit l'isolation multi-tenant même si un utilisateur appartient
                // à plusieurs organisations dans une future évolution du modèle.
                await pool.query(`
                    INSERT INTO daily_cognitive_metrics (
                        utilisateur_id, organisation_id, date,
                        flow_minutes, deep_focus_minutes, friction_minutes, fatigue_minutes,
                        longest_session_minutes, total_focus_minutes, dominant_project_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    ON CONFLICT (utilisateur_id, organisation_id, date) DO UPDATE SET
                        flow_minutes = EXCLUDED.flow_minutes,
                        deep_focus_minutes = EXCLUDED.deep_focus_minutes,
                        friction_minutes = EXCLUDED.friction_minutes,
                        fatigue_minutes = EXCLUDED.fatigue_minutes,
                        longest_session_minutes = EXCLUDED.longest_session_minutes,
                        total_focus_minutes = EXCLUDED.total_focus_minutes,
                        dominant_project_id = EXCLUDED.dominant_project_id
                `, [
                    uid, stats.organisation_id, targetDateStr,
                    stats.flow, stats.deep_focus, stats.friction, stats.fatigue,
                    stats.longest_session, totalFocus, dominantProjectId
                ]);
                totalUsersAggregated++;
            }
        }

        logger.info(`[CognitiveAggregator] Terminée. ${totalUsersAggregated} utilisateurs agrégés pour le ${targetDateStr}.`);
    } catch (err) {
        const logger = require('../config/logger');
        logger.error('[CognitiveAggregator] Erreur:', { error: err.message });
    }
}

module.exports = {
    aggregateCognitiveMetrics
};

// Si exécuté directement
if (require.main === module) {
    aggregateCognitiveMetrics().then(() => process.exit(0));
}
