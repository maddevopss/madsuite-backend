const pool = require('../../../db');

async function getMemoryProfile(userId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const past14Date = new Date();
    past14Date.setDate(past14Date.getDate() - 14);
    const past14Str = past14Date.toISOString().split('T')[0];

    // Fetch Events
    const eventsRes = await pool.query(`
        SELECT state, started_at, duration_minutes, projet_id
        FROM cognitive_state_events
        WHERE utilisateur_id = $1 AND started_at >= $2
    `, [userId, startDateStr]);
    const events = eventsRes.rows;

    // Fetch Daily Metrics
    const dailyRes = await pool.query(`
        SELECT date, flow_minutes, deep_focus_minutes, friction_minutes, fatigue_minutes, context_switches
        FROM daily_cognitive_metrics
        WHERE utilisateur_id = $1 AND date >= $2
    `, [userId, startDateStr]);
    const dailyMetrics = dailyRes.rows;

    if (events.length === 0 && dailyMetrics.length === 0) {
        return null; // Pas assez de donnees
    }

    return {
        avgSessionDuration: calculateAvgSessionDuration(events),
        activeHoursRange: calculateActiveHoursRange(events),
        stabilityIndex: calculateStabilityIndex(events, dailyMetrics)
    };
}

function calculateAvgSessionDuration(events) {
    if (events.length === 0) return 0;
    const totalDuration = events.reduce((sum, ev) => sum + (ev.duration_minutes || 0), 0);
    return Math.round(totalDuration / events.length);
}

function calculateActiveHoursRange(events) {
    if (events.length === 0) return "N/A";
    const hours = events.map(ev => ev.started_at ? new Date(ev.started_at).getHours() : null).filter(h => h !== null);
    if (hours.length === 0) return "N/A";
    const minHour = Math.min(...hours);
    const maxHour = Math.max(...hours);
    return `${minHour}h - ${maxHour}h`;
}

function calculateStabilityIndex(events, dailyMetrics) {
    // Pure calculation: (flow + focus) / total
    if (dailyMetrics.length === 0) return 0;
    
    let totalPositive = 0;
    let totalNegative = 0;

    dailyMetrics.forEach(m => {
        totalPositive += (m.flow_minutes || 0) + (m.deep_focus_minutes || 0);
        totalNegative += (m.friction_minutes || 0) + (m.fatigue_minutes || 0);
    });

    const total = totalPositive + totalNegative;
    if (total === 0) return 100; // default stability

    return Math.round((totalPositive / total) * 100);
}

module.exports = {
    getMemoryProfile
};
