/**
 * Cognitive State Engine
 * SINGLE SOURCE OF TRUTH for cognitive state calculation.
 * Must be pure and deterministic. No database calls.
 */

class CognitiveStateEngine {
    constructor() {
        this.validStates = ['flow', 'deep_focus', 'friction', 'fatigue'];
    }

    /**
     * Compute the new cognitive state based on raw user metrics.
     * MUST be pure and deterministic.
     */
    computeState(metrics) {
        // If metrics explicitly passes a state override, we trust it (for manual triggers if any)
        if (metrics.state && this.validStates.includes(metrics.state)) {
            return {
                state: metrics.state,
                projectId: metrics.projectId || null,
                confidence: metrics.confidence || 1.0,
                timestamp: new Date()
            };
        }

        const {
            sessionDuration = 0,
            contextSwitches = 0,
            timerRunning = false,
            idleTime = 0,
            uiInteractions = 0,
            projectId = null
        } = metrics;

        let scores = { deep_focus: 0, fatigue: 0, friction: 0, flow: 10 };

        // 1. DEEP FOCUS RULES
        if (sessionDuration >= 60 && timerRunning) scores.deep_focus += 40;
        else if (sessionDuration > 30 && timerRunning) scores.deep_focus += 20;
        if (contextSwitches <= 2 && sessionDuration > 15) scores.deep_focus += 30;

        // 2. FATIGUE RULES
        if (sessionDuration > 120) scores.fatigue += 50;
        if (idleTime > 15 && sessionDuration > 60) scores.fatigue += 30;
        if (contextSwitches > 15 && sessionDuration > 90) scores.fatigue += 20;

        // 3. FRICTION RULES
        if (!timerRunning) {
            if (contextSwitches > 10) scores.friction += 40;
            if (idleTime > 5) scores.friction += 30;
            if (uiInteractions > 50 && contextSwitches > 5) scores.friction += 20;
        }

        const THRESHOLD = 40;
        let finalState = "flow";
        let confidence = 0.5;

        if (scores.deep_focus >= THRESHOLD) {
            finalState = "deep_focus";
            confidence = Math.min(0.99, 0.5 + (scores.deep_focus / 200));
        } else if (scores.fatigue >= THRESHOLD) {
            finalState = "fatigue";
            confidence = Math.min(0.99, 0.5 + (scores.fatigue / 200));
        } else if (scores.friction >= THRESHOLD) {
            finalState = "friction";
            confidence = Math.min(0.99, 0.5 + (scores.friction / 200));
        }

        return {
            state: finalState,
            projectId: projectId,
            confidence: Number(confidence.toFixed(2)),
            timestamp: new Date()
        };
    }
}

module.exports = new CognitiveStateEngine();
