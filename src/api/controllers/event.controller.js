const pool = require('../../../db');
const eventProcessor = require('../../core/eventProcessor/eventProcessor');
const historyService = require('../../modules/history/history.service');
const patternsService = require('../../modules/patterns/patterns.service');
const memoryService = require('../../modules/memory/memory.service');
const systemContract = require('../../core/systemContract/cognitiveSystemContract');

const logCognitiveState = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = req.user.organisation_id;
        
        const result = await eventProcessor.processEvent(userId, orgId, req.body);

        if (result.isUnchanged) {
            return res.status(200).json({ message: 'État inchangé', eventId: result.event.id });
        }

        res.status(201).json({ message: 'Nouvel état enregistré', event: result.event });
    } catch (err) {
        if (err.message === 'État cognitif invalide.') {
            return res.status(400).json({ error: err.message });
        }
        console.error('Erreur lors du log cognitif:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

const getDailyCognitiveTimeline = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = req.user.organisation_id;
        const targetDate = req.query.date || new Date().toISOString().split('T')[0];

        const timeline = await historyService.getDailyTimeline(userId, targetDate, orgId);
        res.status(200).json(timeline);
    } catch (err) {
        console.error('Erreur timeline cognitive:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

const getDailyCognitiveInsight = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = req.user.organisation_id;
        const targetDate = req.query.date || new Date().toISOString().split('T')[0];

        // This remains a simple read model mapping
        const insightRes = await pool.query(`
            SELECT m.*, p.nom as dominant_project_name
            FROM daily_cognitive_metrics m
            LEFT JOIN projets p ON m.dominant_project_id = p.id
            WHERE m.utilisateur_id = $1 AND m.date = $2 AND m.organisation_id = $3
        `, [userId, targetDate, orgId]);

        if (insightRes.rows.length === 0) {
            return res.status(200).json(null);
        }

        res.status(200).json(insightRes.rows[0]);
    } catch (err) {
        console.error('Erreur insight cognitif:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

const getCognitivePatterns = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = req.user.organisation_id;
        const rangeParam = req.query.range || '7d';
        const days = parseInt(rangeParam.replace('d', ''), 10) || 7;

        const patterns = await patternsService.analyzePatterns(userId, orgId, days);
        res.status(200).json(patterns || {});
    } catch (err) {
        console.error('Erreur patterns cognitifs:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

const getCognitiveMemoryProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = req.user.organisation_id;
        const rangeParam = req.query.range || '30d';
        const days = parseInt(rangeParam.replace('d', ''), 10) || 30;

        const profile = await memoryService.getMemoryProfile(userId, orgId, days);
        res.status(200).json(profile || {});
    } catch (err) {
        console.error('Erreur memory profile:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

const getDebugSystemState = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = req.user.organisation_id;
        
        // Fetch last event
        const lastEventRes = await pool.query(`
            SELECT id, state, started_at, duration_minutes, projet_id, confidence
            FROM cognitive_state_events
            WHERE utilisateur_id = $1 AND organisation_id = $2
            ORDER BY started_at DESC LIMIT 1
        `, [userId, orgId]);
        
        const lastEvent = lastEventRes.rows[0] || null;

        res.status(200).json({
            lastEvent: lastEvent,
            computedState: lastEvent ? lastEvent.state : 'flow',
            decisionReasons: ["See trace logs or evaluate frontend metrics payload."],
            thresholds: systemContract.getStateTraceabilityMap()
        });
    } catch (err) {
        console.error('Erreur debug system:', err);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

module.exports = {
    logCognitiveState,
    getDailyCognitiveTimeline,
    getDailyCognitiveInsight,
    getCognitivePatterns,
    getCognitiveMemoryProfile,
    getDebugSystemState
};