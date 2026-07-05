const pool = require('../../../db');
const eventProcessor = require('../../core/eventProcessor/eventProcessor');
const historyService = require('../../modules/history/history.service');
const patternsService = require('../../modules/patterns/patterns.service');
const memoryService = require('../../modules/memory/memory.service');
const systemContract = require('../../core/systemContract/cognitiveSystemContract');
const { getOrganisationId } = require('../../utils/organisationScope');
const logger = require('../../config/logger');

const REQUIRED_EVENT_FIELDS = ['sessionDuration', 'contextSwitches', 'timerRunning'];

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function buildSafeCognitivePayload(body) {
    const missing = REQUIRED_EVENT_FIELDS.filter((field) => body[field] === undefined);
    if (missing.length > 0) {
        return { ok: false, error: 'Champs requis manquants', missing };
    }

    if (!isFiniteNumber(body.sessionDuration) || body.sessionDuration < 0 || body.sessionDuration > 1440) {
        return { ok: false, error: 'sessionDuration invalide' };
    }

    if (!Number.isInteger(body.contextSwitches) || body.contextSwitches < 0 || body.contextSwitches > 1000) {
        return { ok: false, error: 'contextSwitches invalide' };
    }

    if (typeof body.timerRunning !== 'boolean') {
        return { ok: false, error: 'timerRunning invalide' };
    }

    if (body.idleTime !== undefined && (!isFiniteNumber(body.idleTime) || body.idleTime < 0 || body.idleTime > 1440)) {
        return { ok: false, error: 'idleTime invalide' };
    }

    if (body.uiInteractions !== undefined && (!Number.isInteger(body.uiInteractions) || body.uiInteractions < 0 || body.uiInteractions > 100000)) {
        return { ok: false, error: 'uiInteractions invalide' };
    }

    if (body.projectId !== undefined && body.projectId !== null && !Number.isInteger(body.projectId)) {
        return { ok: false, error: 'projectId invalide' };
    }

    return {
        ok: true,
        payload: {
            sessionDuration: body.sessionDuration,
            contextSwitches: body.contextSwitches,
            timerRunning: body.timerRunning,
            idleTime: body.idleTime || 0,
            uiInteractions: body.uiInteractions || 0,
            projectId: body.projectId || null,
        },
    };
}

const logCognitiveState = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = getOrganisationId(req);
        const parsed = buildSafeCognitivePayload(req.body || {});

        if (!parsed.ok) {
            return res.status(400).json({
                error: parsed.error,
                required: REQUIRED_EVENT_FIELDS,
                received: Object.keys(req.body || {}),
                missing: parsed.missing || [],
            });
        }

        const result = await eventProcessor.processEvent(userId, orgId, parsed.payload);

        if (result.isUnchanged) {
            return res.status(200).json({ message: 'État inchangé', eventId: result.event.id });
        }

        res.status(201).json({ message: 'Nouvel état enregistré', event: result.event });
    } catch (err) {
        if (err.message === 'État cognitif invalide.') {
            return res.status(400).json({ error: err.message });
        }
        logger.error('Erreur lors du log cognitif', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

const getDailyCognitiveTimeline = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = getOrganisationId(req);
        const targetDate = req.query.date || new Date().toISOString().split('T')[0];

        const timeline = await historyService.getDailyTimeline(userId, targetDate, orgId);
        res.status(200).json(timeline);
    } catch (err) {
        logger.error('Erreur timeline cognitive', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

const getDailyCognitiveInsight = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = getOrganisationId(req);
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
        logger.error('Erreur insight cognitif', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

const getCognitivePatterns = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = getOrganisationId(req);
        const rangeParam = req.query.range || '7d';
        const days = parseInt(rangeParam.replace('d', ''), 10) || 7;

        const patterns = await patternsService.analyzePatterns(userId, orgId, days);
        res.status(200).json(patterns || {});
    } catch (err) {
        logger.error('Erreur patterns cognitifs', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

const getCognitiveMemoryProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = getOrganisationId(req);
        const rangeParam = req.query.range || '30d';
        const days = parseInt(rangeParam.replace('d', ''), 10) || 30;

        const profile = await memoryService.getMemoryProfile(userId, orgId, days);
        res.status(200).json(profile || {});
    } catch (err) {
        logger.error('Erreur memory profile', { error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
};

const getDebugSystemState = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = getOrganisationId(req);
        
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
        logger.error('Erreur debug system', { error: err.message, stack: err.stack });
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
