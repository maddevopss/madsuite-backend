/**
 * MADSuite Cognitive System Contract
 * Exposes the immutable rules of the cognitive architecture.
 * This module does NO computing. It simply explains the system.
 */

class CognitiveSystemContract {
    getSystemFlow() {
        return "event → state → history → aggregates → read models → UI";
    }

    getModuleResponsibilityMap() {
        return {
            "State Engine": "Truth (computes the current state, pure & deterministic)",
            "History": "Storage (append-only events)",
            "Patterns": "Stats (descriptive statistics only)",
            "Memory": "Aggregation (historical daily aggregates)",
            "Recommendations": "Mapping (1:1 state-to-action)",
            "UI": "Rendering (dumb visualization layer)"
        };
    }

    getStateTraceabilityMap() {
        return {
            deep_focus: {
                description: "Deep, uninterrupted work.",
                conditions: [
                    "sessionDuration >= 60 AND timerRunning",
                    "OR sessionDuration > 30 AND timerRunning AND scores.deep_focus >= 40",
                    "OR contextSwitches <= 2 AND sessionDuration > 15"
                ],
                threshold: "deep_focus score >= 40"
            },
            fatigue: {
                description: "Cognitive exhaustion detected.",
                conditions: [
                    "sessionDuration > 120",
                    "OR idleTime > 15 AND sessionDuration > 60",
                    "OR contextSwitches > 15 AND sessionDuration > 90"
                ],
                threshold: "fatigue score >= 40"
            },
            friction: {
                description: "Task switching, stalling, or scattered activity.",
                conditions: [
                    "timerRunning == false AND contextSwitches > 10",
                    "OR timerRunning == false AND idleTime > 5",
                    "OR timerRunning == false AND uiInteractions > 50 AND contextSwitches > 5"
                ],
                threshold: "friction score >= 40"
            },
            flow: {
                description: "Default baseline state.",
                conditions: [
                    "No other state threshold crossed"
                ],
                threshold: "Always defaults to 10"
            }
        };
    }

    /**
     * Re-evaluates why a state was chosen for a given set of metrics (traceability simulation).
     */
    explainDecision(metrics) {
        if (!metrics) return { error: "No metrics provided for explanation." };
        
        const trace = [];
        const {
            sessionDuration = 0,
            contextSwitches = 0,
            timerRunning = false,
            idleTime = 0,
            uiInteractions = 0
        } = metrics;

        // DEEP FOCUS
        if (sessionDuration >= 60 && timerRunning) trace.push("Deep Focus: Session active > 60 min (+40)");
        else if (sessionDuration > 30 && timerRunning) trace.push("Deep Focus: Session active > 30 min (+20)");
        if (contextSwitches <= 2 && sessionDuration > 15) trace.push("Deep Focus: Low context switching (+30)");

        // FATIGUE
        if (sessionDuration > 120) trace.push("Fatigue: Extreme session duration > 120 min (+50)");
        if (idleTime > 15 && sessionDuration > 60) trace.push("Fatigue: High idle time > 15 min (+30)");
        if (contextSwitches > 15 && sessionDuration > 90) trace.push("Fatigue: Fragmented activity (+20)");

        // FRICTION
        if (!timerRunning) {
            if (contextSwitches > 10) trace.push("Friction: Repetitive navigation without active timer (+40)");
            if (idleTime > 5) trace.push("Friction: High idle time before start (+30)");
            if (uiInteractions > 50 && contextSwitches > 5) trace.push("Friction: Scattered activity (+20)");
        }

        return trace.length > 0 ? trace : ["Flow: Standard baseline activity detected"];
    }
}

module.exports = new CognitiveSystemContract();
