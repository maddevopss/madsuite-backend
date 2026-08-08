/**
 * User Preferences Routes
 * REST API endpoints for user preferences and personalization
 * @module routes/user-preferences
 */

const express = require('express');
const router = express.Router();
const userPreferencesService = require('../services/user-preferences.service');
const { requireAuth } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');

/**
 * GET /api/preferences
 * Get user preferences
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { userId, organisationId } = req.user;

    const preferences = await userPreferencesService.getUserPreferences(
      userId,
      organisationId
    );

    res.json({
      success: true,
      data: preferences || {
        theme: 'light',
        language: 'en',
        timezone: 'UTC',
        notifications_enabled: true,
        email_notifications: true,
        push_notifications: true,
        notification_frequency: 'immediate',
        sidebar_collapsed: false,
        compact_mode: false,
        animations_enabled: true,
        accessibility_mode: false,
        dashboard_layout: 'grid',
        default_view: 'dashboard',
        items_per_page: 20,
        personalization_enabled: true,
        recommendations_enabled: true,
        learning_enabled: true,
        custom_settings: {}
      }
    });
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch preferences'
    });
  }
});

/**
 * POST /api/preferences
 * Create or update user preferences
 */
router.post('/', requireAuth, validateRequest({
  body: {
    theme: { type: 'string', enum: ['light', 'dark', 'auto'] },
    language: { type: 'string', enum: ['en', 'fr', 'es', 'de'] },
    timezone: { type: 'string' },
    notifications_enabled: { type: 'boolean' },
    email_notifications: { type: 'boolean' },
    push_notifications: { type: 'boolean' },
    notification_frequency: { type: 'string', enum: ['immediate', 'daily', 'weekly', 'never'] },
    sidebar_collapsed: { type: 'boolean' },
    compact_mode: { type: 'boolean' },
    animations_enabled: { type: 'boolean' },
    accessibility_mode: { type: 'boolean' },
    dashboard_layout: { type: 'string', enum: ['grid', 'list', 'compact'] },
    default_view: { type: 'string' },
    items_per_page: { type: 'number', min: 1, max: 100 },
    personalization_enabled: { type: 'boolean' },
    recommendations_enabled: { type: 'boolean' },
    learning_enabled: { type: 'boolean' },
    custom_settings: { type: 'object' }
  }
}), async (req, res) => {
  try {
    const { userId, organisationId } = req.user;
    const preferences = req.body;

    const updated = await userPreferencesService.upsertUserPreferences(
      userId,
      organisationId,
      preferences
    );

    res.json({
      success: true,
      data: updated,
      message: 'Preferences updated successfully'
    });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update preferences'
    });
  }
});

/**
 * POST /api/preferences/behavior
 * Track user behavior
 */
router.post('/behavior', requireAuth, validateRequest({
  body: {
    event_type: { type: 'string', required: true },
    event_name: { type: 'string', required: true },
    event_category: { type: 'string' },
    page_url: { type: 'string' },
    component_name: { type: 'string' },
    action_type: { type: 'string' },
    duration_ms: { type: 'number' },
    interaction_count: { type: 'number' },
    success: { type: 'boolean' },
    metadata: { type: 'object' }
  }
}), async (req, res) => {
  try {
    const { userId, organisationId } = req.user;
    const behavior = req.body;

    const tracked = await userPreferencesService.trackBehavior(
      userId,
      organisationId,
      behavior
    );

    res.json({
      success: true,
      data: tracked,
      message: 'Behavior tracked successfully'
    });
  } catch (error) {
    console.error('Error tracking behavior:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track behavior'
    });
  }
});

/**
 * GET /api/preferences/analytics
 * Get user behavior analytics
 */
router.get('/analytics', requireAuth, async (req, res) => {
  try {
    const { userId, organisationId } = req.user;
    const {
      event_type,
      start_date,
      end_date,
      limit = 100,
      offset = 0
    } = req.query;

    const analytics = await userPreferencesService.getUserBehaviorAnalytics(
      userId,
      organisationId,
      {
        event_type,
        start_date: start_date ? new Date(start_date) : null,
        end_date: end_date ? new Date(end_date) : null,
        limit: Math.min(parseInt(limit) || 100, 1000),
        offset: parseInt(offset) || 0
      }
    );

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics'
    });
  }
});

/**
 * POST /api/preferences/personalization
 * Save personalization setting
 */
router.post('/personalization', requireAuth, validateRequest({
  body: {
    setting_type: { type: 'string', required: true },
    setting_key: { type: 'string', required: true },
    setting_value: { type: 'object', required: true },
    description: { type: 'string' },
    enabled: { type: 'boolean' },
    priority: { type: 'number' }
  }
}), async (req, res) => {
  try {
    const { userId, organisationId } = req.user;
    const setting = req.body;

    const saved = await userPreferencesService.savePersonalizationSetting(
      userId,
      organisationId,
      setting
    );

    res.json({
      success: true,
      data: saved,
      message: 'Personalization setting saved'
    });
  } catch (error) {
    console.error('Error saving personalization setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save personalization setting'
    });
  }
});

/**
 * GET /api/preferences/personalization
 * Get personalization settings
 */
router.get('/personalization', requireAuth, async (req, res) => {
  try {
    const { userId, organisationId } = req.user;
    const { setting_type } = req.query;

    const settings = await userPreferencesService.getPersonalizationSettings(
      userId,
      organisationId,
      setting_type
    );

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Error fetching personalization settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch personalization settings'
    });
  }
});

/**
 * POST /api/preferences/recommendations
 * Create recommendation
 */
router.post('/recommendations', requireAuth, validateRequest({
  body: {
    recommendation_type: { type: 'string', required: true },
    recommendation_title: { type: 'string', required: true },
    recommendation_description: { type: 'string' },
    confidence_score: { type: 'number', min: 0, max: 1 },
    relevance_score: { type: 'number', min: 0, max: 1 },
    metadata: { type: 'object' },
    action_url: { type: 'string' },
    expires_at: { type: 'string' }
  }
}), async (req, res) => {
  try {
    const { userId, organisationId } = req.user;
    const recommendation = req.body;

    const created = await userPreferencesService.createRecommendation(
      userId,
      organisationId,
      recommendation
    );

    res.json({
      success: true,
      data: created,
      message: 'Recommendation created'
    });
  } catch (error) {
    console.error('Error creating recommendation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create recommendation'
    });
  }
});

/**
 * GET /api/preferences/recommendations
 * Get user recommendations
 */
router.get('/recommendations', requireAuth, async (req, res) => {
  try {
    const { userId, organisationId } = req.user;
    const {
      status = 'pending',
      limit = 10,
      offset = 0
    } = req.query;

    const recommendations = await userPreferencesService.getUserRecommendations(
      userId,
      organisationId,
      {
        status,
        limit: Math.min(parseInt(limit) || 10, 100),
        offset: parseInt(offset) || 0
      }
    );

    res.json({
      success: true,
      data: recommendations
    });
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recommendations'
    });
  }
});

/**
 * PUT /api/preferences/recommendations/:id
 * Update recommendation status
 */
router.put('/recommendations/:id', requireAuth, validateRequest({
  body: {
    status: { type: 'string', enum: ['pending', 'viewed', 'accepted', 'rejected', 'expired'], required: true }
  }
}), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updated = await userPreferencesService.updateRecommendationStatus(
      id,
      status
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Recommendation not found'
      });
    }

    res.json({
      success: true,
      data: updated,
      message: 'Recommendation status updated'
    });
  } catch (error) {
    console.error('Error updating recommendation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update recommendation'
    });
  }
});

/**
 * POST /api/preferences/ui-state
 * Save adaptive UI state
 */
router.post('/ui-state', requireAuth, validateRequest({
  body: {
    state_key: { type: 'string', required: true },
    state_value: { type: 'object', required: true },
    page_context: { type: 'string' },
    device_type: { type: 'string' },
    screen_size: { type: 'string' },
    metadata: { type: 'object' }
  }
}), async (req, res) => {
  try {
    const { userId, organisationId } = req.user;
    const state = req.body;

    const saved = await userPreferencesService.saveAdaptiveUIState(
      userId,
      organisationId,
      state
    );

    res.json({
      success: true,
      data: saved,
      message: 'UI state saved'
    });
  } catch (error) {
    console.error('Error saving UI state:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save UI state'
    });
  }
});

/**
 * GET /api/preferences/ui-state
 * Get adaptive UI state
 */
router.get('/ui-state', requireAuth, async (req, res) => {
  try {
    const { userId, organisationId } = req.user;
    const { state_key } = req.query;

    const states = await userPreferencesService.getAdaptiveUIState(
      userId,
      organisationId,
      state_key
    );

    res.json({
      success: true,
      data: states
    });
  } catch (error) {
    console.error('Error fetching UI state:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch UI state'
    });
  }
});

/**
 * GET /api/preferences/score
 * Get personalization score
 */
router.get('/score', requireAuth, async (req, res) => {
  try {
    const { userId, organisationId } = req.user;

    const score = await userPreferencesService.calculatePersonalizationScore(
      userId,
      organisationId
    );

    res.json({
      success: true,
      data: score
    });
  } catch (error) {
    console.error('Error calculating personalization score:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate personalization score'
    });
  }
});

module.exports = router;
