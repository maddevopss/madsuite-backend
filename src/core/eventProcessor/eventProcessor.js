const cognitiveStateEngine = require('../stateEngine/cognitiveStateEngine');
const historyService = require('../../modules/history/history.service');
const logger = require('../../config/logger');

class EventProcessor {
    /**
     * Ingests a raw user action event, computes state, and persists.
     */
    async processEvent(userId, orgId, rawPayload) {
        logger.info("event_processor_ingest", { userId, orgId, rawPayload });

        // 1. Calculate deterministic state
        const computedState = cognitiveStateEngine.computeState(rawPayload);
        
        logger.info("event_processor_computed", { userId, orgId, computedState });

        // 2. Persist to history (append-only logic)
        const result = await historyService.appendEvent(
            userId, 
            orgId, 
            computedState.state, 
            computedState.projectId, 
            computedState.confidence
        );

        logger.info("event_processor_persisted", { 
            userId, 
            orgId, 
            isUnchanged: result.isUnchanged, 
            eventId: result.event?.id 
        });

        return result;
    }
}

module.exports = new EventProcessor();
