/**
 * MADSuite Cognitive System Contract
 * Exposes the deterministic rules of the work-context signal architecture.
 * This module does NO computing. It simply explains the system.
 *
 * MADPROOF guardrail:
 * States returned by this subsystem are functional work-mode estimates based on
 * application signals. They are not diagnoses, medical conclusions, or measures
 * of a user's real mental state.
 */

class CognitiveSystemContract {
    getSystemFlow() {
        return "event → estimated work mode → history → aggregates → read models → UI";
    }

    getModuleResponsibilityMap() {
        return {
            "State Engine": "Deterministic mapping (computes an estimated work mode from application signals)",
            "History": "Storage (append-only events)",
            "Patterns": "Stats (descriptive statistics only)",
            "Memory": "Aggregation (historical daily aggregates)",
            "Recommendations": "Mapping (1:1 signal-to-action)",
            "UI": "Rendering (visualization layer)"
        };
    }

    getStateTraceabilityMap() {
        return {
            deep_focus: {
                description: "Stable timer session with low context switching.",
                conditions: [
                    "sessionDuration >= 60 AND timerRunning",
                    "OR sessionDuration > 30 AND timerRunning AND scores.deep_focus >= 40",
                    "OR contextSwitches <= 2 AND sessionDuration > 15"
                ],
                threshold: "deep_focus score >= 40"
            },
            fatigue: {
                description: "Long or interrupted session pattern.",
                conditions: [
                    "sessionDuration > 120",
                    "OR idleTime > 15 AND sessionDuration > 60",
                    "OR contextSwitches > 15 AND sessionDuration > 90"
                ],
                threshold: "fatigue score >= 40"
            },
            friction: {
                description: "Task switching, stalling, or scattered application activity.",
                conditions: [
                    "timerRunning == false AND contextSwitches > 10",
                    "OR timerRunning == false AND idleTime > 5",
                    "OR timerRunning == false AND uiInteractions > 50 AND contextSwitches > 5"
                ],
                threshold: "friction score >= 40"
            },
            flow: {
                description: "Default baseline application activity pattern.",
                conditions: [
                    "No other state threshold crossed"
                ],
                threshold: "Always defaults to 10"
            }
        };
    }

    /**
     * Re-evaluates why a work-mode estimate was chosen for a given set of metrics.
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

        // STABLE SESSION
        if (sessionDuration >= 60 && timerRunning) trace.push("Stable session: active timer > 60 min (+40)");
        else if (sessionDuration > 30 && timerRunning) trace.push("Stable session: active timer > 30 min (+20)");
        if (contextSwitches <= 2 && sessionDuration > 15) trace.push("Stable session: low context switching (+30)");

        // LONG / INTERRUPTED SESSION
        if (sessionDuration > 120) trace.push("Long session pattern: duration > 120 min (+50)");
        if (idleTime > 15 && sessionDuration > 60) trace.push("Interrupted session pattern: idle time > 15 min (+30)");
        if (contextSwitches > 15 && sessionDuration > 90) trace.push("Fragmented activity pattern (+20)");

        // FRICTION
        if (!timerRunning) {
            if (contextSwitches > 10) trace.push("Friction: repetitive navigation without active timer (+40)");
            if (idleTime > 5) trace.push("Friction: idle time before start (+30)");
            if (uiInteractions > 50 && contextSwitches > 5) trace.push("Friction: scattered application activity (+20)");
        }

        return trace.length > 0 ? trace : ["Baseline: standard application activity pattern"];
    }
}

module.exports = new CognitiveSystemContract();