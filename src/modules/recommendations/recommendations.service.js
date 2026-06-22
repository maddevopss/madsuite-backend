class RecommendationsService {
    /**
     * Maps a state to an action (1:1 mapping only)
     * @param {Object} stateObj 
     */
    getRecommendation(stateObj) {
        const { state } = stateObj;

        const actionsMap = {
            'deep_focus': {
                type: "action",
                state: "deep_focus",
                title: "Tu es en session profonde.",
                actionLabel: "Pause optionnelle 3 min",
                priority: "medium",
                actionKey: "pause"
            },
            'fatigue': {
                type: "action",
                state: "fatigue",
                title: "Une pause pourrait améliorer ta prochaine session.",
                actionLabel: "Pause 5 min",
                priority: "high",
                actionKey: "pause"
            },
            'friction': {
                type: "action",
                state: "friction",
                title: "Action recommandée : Reprendre la tâche principale.",
                actionLabel: "Démarrer session 5 min",
                priority: "high",
                actionKey: "start_pomodoro"
            },
            'flow': {
                type: "none"
            }
        };

        return actionsMap[state] || { type: "none" };
    }
}

module.exports = new RecommendationsService();
