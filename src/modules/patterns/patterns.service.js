const pool = require('../../../db');

async function analyzePatterns(userId, orgId, days = 7) {
    // Determine the date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    // 1. Fetch cognitive state events
    const eventsRes = await pool.query(`
        SELECT state, started_at, duration_minutes, projet_id
        FROM cognitive_state_events
        WHERE utilisateur_id = $1 AND organisation_id = $2 AND started_at >= $3
        ORDER BY started_at ASC
    `, [userId, orgId, startDateStr]);
    const events = eventsRes.rows;

    // 2. Fetch daily cognitive metrics
    const dailyRes = await pool.query(`
        SELECT flow_minutes, deep_focus_minutes, friction_minutes, fatigue_minutes, context_switches
        FROM daily_cognitive_metrics
        WHERE utilisateur_id = $1 AND organisation_id = $2 AND date >= $3
    `, [userId, orgId, startDateStr]);
    const dailyMetrics = dailyRes.rows;

    if (events.length === 0 && dailyMetrics.length === 0) {
        return null; // Not enough data
    }

    return {
        bestFocusWindow: calculateBestFocusWindow(events),
        worstFocusWindow: calculateWorstFocusWindow(events),
        dominantProject: await calculateDominantProject(events, orgId),
        averageTimeToDeepFocus: calculateAverageTimeToDeepFocus(events),
        averageContextSwitches: calculateAverageContextSwitches(dailyMetrics)
    };
}

function calculateBestFocusWindow(events) {
    const hours = new Array(24).fill(0);
    let totalFocusEvents = 0;

    events.forEach(ev => {
        if (ev.state === 'deep_focus' && ev.started_at) {
            const hour = new Date(ev.started_at).getHours();
            hours[hour]++;
            totalFocusEvents++;
        }
    });

    if (totalFocusEvents === 0) return null;

    let bestHour = 0;
    let maxEvents = 0;
    for (let i = 0; i < 24; i++) {
        if (hours[i] > maxEvents) {
            maxEvents = hours[i];
            bestHour = i;
        }
    }

    const confidence = Math.round((maxEvents / totalFocusEvents) * 100);
    const endHour = (bestHour + 2) % 24; // 2 hour window for UI simplicity

    return {
        start: `${bestHour.toString().padStart(2, '0')}:00`,
        end: `${endHour.toString().padStart(2, '0')}:00`,
        confidence
    };
}

function calculateWorstFocusWindow(events) {
    const hours = new Array(24).fill(0);
    let totalBadEvents = 0;

    events.forEach(ev => {
        if ((ev.state === 'friction' || ev.state === 'fatigue') && ev.started_at) {
            const hour = new Date(ev.started_at).getHours();
            hours[hour]++;
            totalBadEvents++;
        }
    });

    if (totalBadEvents === 0) return null;

    let worstHour = 0;
    let maxEvents = 0;
    for (let i = 0; i < 24; i++) {
        if (hours[i] > maxEvents) {
            maxEvents = hours[i];
            worstHour = i;
        }
    }

    const endHour = (worstHour + 1) % 24; // 1.5 - 2 hour window

    return {
        start: `${worstHour.toString().padStart(2, '0')}:00`,
        end: `${endHour.toString().padStart(2, '0')}:30`
    };
}

async function calculateDominantProject(events, orgId) {
    const projectMins = {};
    events.forEach(ev => {
        if (ev.state === 'deep_focus' && ev.projet_id) {
            projectMins[ev.projet_id] = (projectMins[ev.projet_id] || 0) + (ev.duration_minutes || 0);
        }
    });

    let domProjId = null;
    let maxMins = 0;
    for (const [pid, mins] of Object.entries(projectMins)) {
        if (mins > maxMins) {
            maxMins = mins;
            domProjId = pid;
        }
    }

    if (!domProjId) return null;

    // Fetch name within the current organisation only.
    const projRes = await pool.query(`SELECT nom FROM projets WHERE id = $1 AND organisation_id = $2`, [domProjId, orgId]);
    const nom = projRes.rows.length > 0 ? projRes.rows[0].nom : 'Projet inconnu';

    return {
        dominantProjectId: domProjId,
        projectName: nom,
        totalDeepFocusMinutes: maxMins
    };
}

function calculateAverageTimeToDeepFocus(events) {
    const days = {};
    
    // Group by day
    events.forEach(ev => {
        if (!ev.started_at) return;
        const d = new Date(ev.started_at);
        const dateStr = d.toISOString().split('T')[0];
        
        if (!days[dateStr]) days[dateStr] = [];
        days[dateStr].push(ev);
    });

    let totalDiffMins = 0;
    let validDays = 0;

    for (const [date, dayEvents] of Object.entries(days)) {
        if (dayEvents.length < 2) continue;
        
        // Find first event of the day
        const firstEvent = dayEvents[0];
        
        // Find first deep_focus
        const firstDeepFocus = dayEvents.find(e => e.state === 'deep_focus');

        if (firstEvent && firstDeepFocus && firstEvent !== firstDeepFocus) {
            const diffMs = new Date(firstDeepFocus.started_at) - new Date(firstEvent.started_at);
            if (diffMs > 0) {
                totalDiffMins += Math.floor(diffMs / 60000);
                validDays++;
            }
        }
    }

    if (validDays === 0) return null;
    return Math.round(totalDiffMins / validDays);
}

function calculateAverageContextSwitches(dailyMetrics) {
    if (dailyMetrics.length === 0) return 0;
    
    let totalSwitches = 0;
    dailyMetrics.forEach(m => {
        totalSwitches += (m.context_switches || 0);
    });

    return Math.round(totalSwitches / dailyMetrics.length);
}

module.exports = {
    analyzePatterns
};
