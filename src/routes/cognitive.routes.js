const express = require('express');
const router = express.Router();
const { 
    logCognitiveState, 
    getDailyCognitiveTimeline, 
    getDailyCognitiveInsight, 
    getCognitivePatterns,
    getCognitiveMemoryProfile,
    getDebugSystemState
} = require('../api/controllers/event.controller');
const verifyToken = require('../middleware/auth');

// POST /api/cognitive/events
router.post('/events', verifyToken, logCognitiveState);

// GET /api/cognitive/timeline
router.get('/timeline', verifyToken, getDailyCognitiveTimeline);

// GET /api/cognitive/insight
router.get('/insight', verifyToken, getDailyCognitiveInsight);

// GET /api/cognitive/patterns
router.get('/patterns', verifyToken, getCognitivePatterns);

// GET /api/cognitive/memory-profile
router.get('/memory-profile', verifyToken, getCognitiveMemoryProfile);

// GET /api/cognitive/debug/cognitive-state
router.get('/debug/cognitive-state', verifyToken, getDebugSystemState);

module.exports = router;
