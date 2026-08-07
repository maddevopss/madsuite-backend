/**
 * User Preferences Service
 * Manages user preferences, behavior tracking, and personalization
 * @module services/user-preferences
 */

const db = require('../db');

/**
 * Get user preferences
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @returns {Promise<Object>} User preferences
 */
async function getUserPreferences(userId, organisationId) {
  const result = await db.query(
    `SELECT * FROM user_preferences 
     WHERE user_id = $1 AND organisation_id = $2`,
    [userId, organisationId]
  );
  
  return result.rows[0] || null;
}

/**
 * Create or update user preferences
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} preferences - Preference data
 * @returns {Promise<Object>} Updated preferences
 */
async function upsertUserPreferences(userId, organisationId, preferences) {
  const {
    theme = 'light',
    language = 'en',
    timezone = 'UTC',
    notifications_enabled = true,
    email_notifications = true,
    push_notifications = true,
    notification_frequency = 'immediate',
    sidebar_collapsed = false,
    compact_mode = false,
    animations_enabled = true,
    accessibility_mode = false,
    dashboard_layout = 'grid',
    default_view = 'dashboard',
    items_per_page = 20,
    personalization_enabled = true,
    recommendations_enabled = true,
    learning_enabled = true,
    custom_settings = {}
  } = preferences;

  const result = await db.query(
    `INSERT INTO user_preferences (
      user_id, organisation_id, theme, language, timezone,
      notifications_enabled, email_notifications, push_notifications,
      notification_frequency, sidebar_collapsed, compact_mode,
      animations_enabled, accessibility_mode, dashboard_layout,
      default_view, items_per_page, personalization_enabled,
      recommendations_enabled, learning_enabled, custom_settings
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    ON CONFLICT (organisation_id, user_id) DO UPDATE SET
      theme = EXCLUDED.theme,
      language = EXCLUDED.language,
      timezone = EXCLUDED.timezone,
      notifications_enabled = EXCLUDED.notifications_enabled,
      email_notifications = EXCLUDED.email_notifications,
      push_notifications = EXCLUDED.push_notifications,
      notification_frequency = EXCLUDED.notification_frequency,
      sidebar_collapsed = EXCLUDED.sidebar_collapsed,
      compact_mode = EXCLUDED.compact_mode,
      animations_enabled = EXCLUDED.animations_enabled,
      accessibility_mode = EXCLUDED.accessibility_mode,
      dashboard_layout = EXCLUDED.dashboard_layout,
      default_view = EXCLUDED.default_view,
      items_per_page = EXCLUDED.items_per_page,
      personalization_enabled = EXCLUDED.personalization_enabled,
      recommendations_enabled = EXCLUDED.recommendations_enabled,
      learning_enabled = EXCLUDED.learning_enabled,
      custom_settings = EXCLUDED.custom_settings
    RETURNING *`,
    [
      userId, organisationId, theme, language, timezone,
      notifications_enabled, email_notifications, push_notifications,
      notification_frequency, sidebar_collapsed, compact_mode,
      animations_enabled, accessibility_mode, dashboard_layout,
      default_view, items_per_page, personalization_enabled,
      recommendations_enabled, learning_enabled, custom_settings
    ]
  );

  return result.rows[0];
}

/**
 * Track user behavior
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} behavior - Behavior data
 * @returns {Promise<Object>} Tracked behavior
 */
async function trackBehavior(userId, organisationId, behavior) {
  const {
    event_type,
    event_name,
    event_category,
    page_url,
    component_name,
    action_type,
    duration_ms,
    interaction_count = 1,
    success = true,
    metadata = {}
  } = behavior;

  const result = await db.query(
    `INSERT INTO user_behavior_tracking (
      user_id, organisation_id, event_type, event_name, event_category,
      page_url, component_name, action_type, duration_ms,
      interaction_count, success, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      userId, organisationId, event_type, event_name, event_category,
      page_url, component_name, action_type, duration_ms,
      interaction_count, success, JSON.stringify(metadata)
    ]
  );

  return result.rows[0];
}

/**
 * Get user behavior analytics
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Behavior records
 */
async function getUserBehaviorAnalytics(userId, organisationId, options = {}) {
  const {
    event_type,
    start_date,
    end_date,
    limit = 100,
    offset = 0
  } = options;

  let query = `SELECT * FROM user_behavior_tracking 
               WHERE user_id = $1 AND organisation_id = $2`;
  const params = [userId, organisationId];
  let paramIndex = 3;

  if (event_type) {
    query += ` AND event_type = $${paramIndex}`;
    params.push(event_type);
    paramIndex++;
  }

  if (start_date) {
    query += ` AND created_at >= $${paramIndex}`;
    params.push(start_date);
    paramIndex++;
  }

  if (end_date) {
    query += ` AND created_at <= $${paramIndex}`;
    params.push(end_date);
    paramIndex++;
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Save personalization setting
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} setting - Setting data
 * @returns {Promise<Object>} Saved setting
 */
async function savePersonalizationSetting(userId, organisationId, setting) {
  const {
    setting_type,
    setting_key,
    setting_value,
    description,
    enabled = true,
    priority = 0
  } = setting;

  const result = await db.query(
    `INSERT INTO personalization_settings (
      user_id, organisation_id, setting_type, setting_key,
      setting_value, description, enabled, priority
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (organisation_id, user_id, setting_type, setting_key) DO UPDATE SET
      setting_value = EXCLUDED.setting_value,
      description = EXCLUDED.description,
      enabled = EXCLUDED.enabled,
      priority = EXCLUDED.priority
    RETURNING *`,
    [
      userId, organisationId, setting_type, setting_key,
      JSON.stringify(setting_value), description, enabled, priority
    ]
  );

  return result.rows[0];
}

/**
 * Get personalization settings
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} settingType - Optional setting type filter
 * @returns {Promise<Array>} Personalization settings
 */
async function getPersonalizationSettings(userId, organisationId, settingType = null) {
  let query = `SELECT * FROM personalization_settings 
               WHERE user_id = $1 AND organisation_id = $2`;
  const params = [userId, organisationId];

  if (settingType) {
    query += ` AND setting_type = $3`;
    params.push(settingType);
  }

  query += ` ORDER BY priority DESC, created_at DESC`;

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Create recommendation
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} recommendation - Recommendation data
 * @returns {Promise<Object>} Created recommendation
 */
async function createRecommendation(userId, organisationId, recommendation) {
  const {
    recommendation_type,
    recommendation_title,
    recommendation_description,
    confidence_score = 0.5,
    relevance_score = 0.5,
    metadata = {},
    action_url,
    expires_at
  } = recommendation;

  const result = await db.query(
    `INSERT INTO user_recommendations (
      user_id, organisation_id, recommendation_type, recommendation_title,
      recommendation_description, confidence_score, relevance_score,
      metadata, action_url, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      userId, organisationId, recommendation_type, recommendation_title,
      recommendation_description, confidence_score, relevance_score,
      JSON.stringify(metadata), action_url, expires_at
    ]
  );

  return result.rows[0];
}

/**
 * Get user recommendations
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Recommendations
 */
async function getUserRecommendations(userId, organisationId, options = {}) {
  const {
    status = 'pending',
    limit = 10,
    offset = 0
  } = options;

  const result = await db.query(
    `SELECT * FROM user_recommendations 
     WHERE user_id = $1 AND organisation_id = $2 AND status = $3
     AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
    [userId, organisationId, status, limit, offset]
  );

  return result.rows;
}

/**
 * Update recommendation status
 * @param {string} recommendationId - Recommendation ID
 * @param {string} status - New status
 * @returns {Promise<Object>} Updated recommendation
 */
async function updateRecommendationStatus(recommendationId, status) {
  const updateFields = { status };

  if (status === 'viewed') {
    updateFields.viewed_at = new Date();
  } else if (status === 'accepted' || status === 'rejected') {
    updateFields.acted_at = new Date();
  }

  const result = await db.query(
    `UPDATE user_recommendations 
     SET status = $1, viewed_at = $2, acted_at = $3
     WHERE id = $4
     RETURNING *`,
    [status, updateFields.viewed_at || null, updateFields.acted_at || null, recommendationId]
  );

  return result.rows[0];
}

/**
 * Save adaptive UI state
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} state - UI state data
 * @returns {Promise<Object>} Saved state
 */
async function saveAdaptiveUIState(userId, organisationId, state) {
  const {
    state_key,
    state_value,
    page_context,
    device_type,
    screen_size,
    metadata = {}
  } = state;

  const result = await db.query(
    `INSERT INTO adaptive_ui_state (
      user_id, organisation_id, state_key, state_value,
      page_context, device_type, screen_size, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (organisation_id, user_id, state_key) DO UPDATE SET
      state_value = EXCLUDED.state_value,
      page_context = EXCLUDED.page_context,
      device_type = EXCLUDED.device_type,
      screen_size = EXCLUDED.screen_size,
      metadata = EXCLUDED.metadata
    RETURNING *`,
    [
      userId, organisationId, state_key, JSON.stringify(state_value),
      page_context, device_type, screen_size, JSON.stringify(metadata)
    ]
  );

  return result.rows[0];
}

/**
 * Get adaptive UI state
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} stateKey - Optional state key filter
 * @returns {Promise<Array>} UI states
 */
async function getAdaptiveUIState(userId, organisationId, stateKey = null) {
  let query = `SELECT * FROM adaptive_ui_state 
               WHERE user_id = $1 AND organisation_id = $2`;
  const params = [userId, organisationId];

  if (stateKey) {
    query += ` AND state_key = $3`;
    params.push(stateKey);
  }

  query += ` ORDER BY updated_at DESC`;

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Calculate personalization score
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @returns {Promise<Object>} Personalization metrics
 */
async function calculatePersonalizationScore(userId, organisationId) {
  // Get behavior data
  const behaviorResult = await db.query(
    `SELECT 
      COUNT(*) as total_events,
      COUNT(DISTINCT event_type) as unique_event_types,
      AVG(CASE WHEN success THEN 1 ELSE 0 END) as success_rate,
      AVG(duration_ms) as avg_duration
     FROM user_behavior_tracking
     WHERE user_id = $1 AND organisation_id = $2
     AND created_at > NOW() - INTERVAL '30 days'`,
    [userId, organisationId]
  );

  // Get preferences data
  const prefsResult = await db.query(
    `SELECT 
      personalization_enabled,
      recommendations_enabled,
      learning_enabled
     FROM user_preferences
     WHERE user_id = $1 AND organisation_id = $2`,
    [userId, organisationId]
  );

  const behavior = behaviorResult.rows[0] || {};
  const prefs = prefsResult.rows[0] || {};

  // Calculate score (0-100)
  let score = 50; // Base score

  if (behavior.total_events > 100) score += 20;
  else if (behavior.total_events > 50) score += 10;

  if (behavior.success_rate > 0.8) score += 15;
  else if (behavior.success_rate > 0.6) score += 8;

  if (prefs.personalization_enabled) score += 10;
  if (prefs.recommendations_enabled) score += 5;
  if (prefs.learning_enabled) score += 5;

  return {
    score: Math.min(100, score),
    total_events: parseInt(behavior.total_events) || 0,
    unique_event_types: parseInt(behavior.unique_event_types) || 0,
    success_rate: parseFloat(behavior.success_rate) || 0,
    avg_duration: parseInt(behavior.avg_duration) || 0,
    personalization_enabled: prefs.personalization_enabled,
    recommendations_enabled: prefs.recommendations_enabled,
    learning_enabled: prefs.learning_enabled
  };
}

module.exports = {
  getUserPreferences,
  upsertUserPreferences,
  trackBehavior,
  getUserBehaviorAnalytics,
  savePersonalizationSetting,
  getPersonalizationSettings,
  createRecommendation,
  getUserRecommendations,
  updateRecommendationStatus,
  saveAdaptiveUIState,
  getAdaptiveUIState,
  calculatePersonalizationScore
};
