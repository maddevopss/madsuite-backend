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
const requireOrganisation = require('../middleware/requireOrganisation');

// POST /api/cognitive/events
router.post('/events', verifyToken, requireOrganisation, logCognitiveState);

// GET /api/cognitive/timeline
router.get('/timeline', verifyToken, requireOrganisation, getDailyCognitiveTimeline);

// GET /api/cognitive/insight
router.get('/insight', verifyToken, requireOrganisation, getDailyCognitiveInsight);

// GET /api/cognitive/patterns
router.get('/patterns', verifyToken, requireOrganisation, getCognitivePatterns);

// GET /api/cognitive/memory-profile
router.get('/memory-profile', verifyToken, requireOrganisation, getCognitiveMemoryProfile);

// GET /api/cognitive/debug/cognitive-state
router.get('/debug/cognitive-state', verifyToken, requireOrganisation, getDebugSystemState);

module.exports = router;