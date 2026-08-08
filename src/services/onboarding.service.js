/**
 * Onboarding Service
 * Manages onboarding flows, tutorials, help system, and feature discovery
 * @module services/onboarding
 */

const db = require('../db');

/**
 * Get onboarding progress
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} flowType - Onboarding flow type
 * @returns {Promise<Object>} Onboarding progress
 */
async function getOnboardingProgress(userId, organisationId, flowType) {
  const result = await db.query(
    `SELECT * FROM onboarding_progress 
     WHERE user_id = $1 AND organisation_id = $2 AND flow_type = $3`,
    [userId, organisationId, flowType]
  );
  
  return result.rows[0] || null;
}

/**
 * Create or update onboarding progress
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} progress - Progress data
 * @returns {Promise<Object>} Updated progress
 */
async function upsertOnboardingProgress(userId, organisationId, progress) {
  const {
    flow_type,
    current_step = 1,
    total_steps = 5,
    status = 'in_progress',
    metadata = {}
  } = progress;

  const result = await db.query(
    `INSERT INTO onboarding_progress (
      user_id, organisation_id, flow_type, current_step, total_steps, status, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (organisation_id, user_id, flow_type) DO UPDATE SET
      current_step = EXCLUDED.current_step,
      total_steps = EXCLUDED.total_steps,
      status = EXCLUDED.status,
      metadata = EXCLUDED.metadata
    RETURNING *`,
    [userId, organisationId, flow_type, current_step, total_steps, status, JSON.stringify(metadata)]
  );

  return result.rows[0];
}

/**
 * Complete onboarding step
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} flowType - Onboarding flow type
 * @param {number} stepNumber - Step number
 * @returns {Promise<Object>} Updated progress
 */
async function completeOnboardingStep(userId, organisationId, flowType, stepNumber) {
  const progress = await getOnboardingProgress(userId, organisationId, flowType);
  
  if (!progress) {
    throw new Error('Onboarding progress not found');
  }

  const nextStep = stepNumber + 1;
  const isCompleted = nextStep > progress.total_steps;
  const newStatus = isCompleted ? 'completed' : 'in_progress';
  const completedAt = isCompleted ? new Date() : null;

  const result = await db.query(
    `UPDATE onboarding_progress 
     SET current_step = $1, status = $2, completed_at = $3
     WHERE user_id = $4 AND organisation_id = $5 AND flow_type = $6
     RETURNING *`,
    [nextStep, newStatus, completedAt, userId, organisationId, flowType]
  );

  return result.rows[0];
}

/**
 * Skip onboarding
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} flowType - Onboarding flow type
 * @returns {Promise<Object>} Updated progress
 */
async function skipOnboarding(userId, organisationId, flowType) {
  const result = await db.query(
    `UPDATE onboarding_progress 
     SET status = 'skipped', completed_at = NOW()
     WHERE user_id = $1 AND organisation_id = $2 AND flow_type = $3
     RETURNING *`,
    [userId, organisationId, flowType]
  );

  return result.rows[0];
}

/**
 * Get tutorial completion
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} tutorialId - Tutorial ID
 * @returns {Promise<Object>} Tutorial completion record
 */
async function getTutorialCompletion(userId, organisationId, tutorialId) {
  const result = await db.query(
    `SELECT * FROM tutorial_completion 
     WHERE user_id = $1 AND organisation_id = $2 AND tutorial_id = $3`,
    [userId, organisationId, tutorialId]
  );
  
  return result.rows[0] || null;
}

/**
 * Start tutorial
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} tutorial - Tutorial data
 * @returns {Promise<Object>} Tutorial completion record
 */
async function startTutorial(userId, organisationId, tutorial) {
  const {
    tutorial_id,
    tutorial_title,
    tutorial_category
  } = tutorial;

  const result = await db.query(
    `INSERT INTO tutorial_completion (
      user_id, organisation_id, tutorial_id, tutorial_title, tutorial_category,
      status, started_at
    ) VALUES ($1, $2, $3, $4, $5, 'in_progress', NOW())
    ON CONFLICT (organisation_id, user_id, tutorial_id) DO UPDATE SET
      status = 'in_progress',
      started_at = NOW()
    RETURNING *`,
    [userId, organisationId, tutorial_id, tutorial_title, tutorial_category]
  );

  return result.rows[0];
}

/**
 * Update tutorial progress
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} tutorialId - Tutorial ID
 * @param {number} progressPercentage - Progress percentage (0-100)
 * @returns {Promise<Object>} Updated tutorial completion
 */
async function updateTutorialProgress(userId, organisationId, tutorialId, progressPercentage) {
  const result = await db.query(
    `UPDATE tutorial_completion 
     SET progress_percentage = $1
     WHERE user_id = $2 AND organisation_id = $3 AND tutorial_id = $4
     RETURNING *`,
    [progressPercentage, userId, organisationId, tutorialId]
  );

  return result.rows[0];
}

/**
 * Complete tutorial
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} tutorialId - Tutorial ID
 * @returns {Promise<Object>} Updated tutorial completion
 */
async function completeTutorial(userId, organisationId, tutorialId) {
  const result = await db.query(
    `UPDATE tutorial_completion 
     SET status = 'completed', progress_percentage = 100, completed_at = NOW()
     WHERE user_id = $1 AND organisation_id = $2 AND tutorial_id = $3
     RETURNING *`,
    [userId, organisationId, tutorialId]
  );

  return result.rows[0];
}

/**
 * Skip tutorial
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} tutorialId - Tutorial ID
 * @returns {Promise<Object>} Updated tutorial completion
 */
async function skipTutorial(userId, organisationId, tutorialId) {
  const result = await db.query(
    `UPDATE tutorial_completion 
     SET status = 'skipped'
     WHERE user_id = $1 AND organisation_id = $2 AND tutorial_id = $3
     RETURNING *`,
    [userId, organisationId, tutorialId]
  );

  return result.rows[0];
}

/**
 * Get user tutorials
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Tutorial completion records
 */
async function getUserTutorials(userId, organisationId, options = {}) {
  const {
    status,
    category,
    limit = 50,
    offset = 0
  } = options;

  let query = `SELECT * FROM tutorial_completion 
               WHERE user_id = $1 AND organisation_id = $2`;
  const params = [userId, organisationId];
  let paramIndex = 3;

  if (status) {
    query += ` AND status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  if (category) {
    query += ` AND tutorial_category = $${paramIndex}`;
    params.push(category);
    paramIndex++;
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Get help articles
 * @param {string} organisationId - Organisation ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Help articles
 */
async function getHelpArticles(organisationId, options = {}) {
  const {
    category,
    featured = false,
    search,
    limit = 50,
    offset = 0
  } = options;

  let query = `SELECT * FROM help_articles 
               WHERE organisation_id = $1 AND published = true`;
  const params = [organisationId];
  let paramIndex = 2;

  if (category) {
    query += ` AND article_category = $${paramIndex}`;
    params.push(category);
    paramIndex++;
  }

  if (featured) {
    query += ` AND featured = true`;
  }

  if (search) {
    query += ` AND (article_title ILIKE $${paramIndex} OR article_content ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  query += ` ORDER BY featured DESC, created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Get help article by slug
 * @param {string} organisationId - Organisation ID
 * @param {string} slug - Article slug
 * @returns {Promise<Object>} Help article
 */
async function getHelpArticleBySlug(organisationId, slug) {
  const result = await db.query(
    `SELECT * FROM help_articles 
     WHERE organisation_id = $1 AND article_slug = $2 AND published = true`,
    [organisationId, slug]
  );
  
  return result.rows[0] || null;
}

/**
 * Create help article
 * @param {string} organisationId - Organisation ID
 * @param {Object} article - Article data
 * @returns {Promise<Object>} Created article
 */
async function createHelpArticle(organisationId, article) {
  const {
    article_slug,
    article_title,
    article_content,
    article_category,
    keywords,
    related_articles = [],
    published = true,
    featured = false
  } = article;

  const result = await db.query(
    `INSERT INTO help_articles (
      organisation_id, article_slug, article_title, article_content,
      article_category, keywords, related_articles, published, featured
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      organisationId, article_slug, article_title, article_content,
      article_category, keywords, related_articles, published, featured
    ]
  );

  return result.rows[0];
}

/**
 * Get feature discovery
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} featureId - Feature ID
 * @returns {Promise<Object>} Feature discovery record
 */
async function getFeatureDiscovery(userId, organisationId, featureId) {
  const result = await db.query(
    `SELECT * FROM feature_discovery 
     WHERE user_id = $1 AND organisation_id = $2 AND feature_id = $3`,
    [userId, organisationId, featureId]
  );
  
  return result.rows[0] || null;
}

/**
 * Create feature discovery
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} feature - Feature data
 * @returns {Promise<Object>} Created feature discovery
 */
async function createFeatureDiscovery(userId, organisationId, feature) {
  const {
    feature_id,
    feature_name,
    feature_description,
    feature_category,
    metadata = {}
  } = feature;

  const result = await db.query(
    `INSERT INTO feature_discovery (
      user_id, organisation_id, feature_id, feature_name,
      feature_description, feature_category, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (organisation_id, user_id, feature_id) DO UPDATE SET
      status = 'discovered',
      discovered_at = NOW()
    RETURNING *`,
    [userId, organisationId, feature_id, feature_name, feature_description, feature_category, JSON.stringify(metadata)]
  );

  return result.rows[0];
}

/**
 * Dismiss feature discovery
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} featureId - Feature ID
 * @returns {Promise<Object>} Updated feature discovery
 */
async function dismissFeatureDiscovery(userId, organisationId, featureId) {
  const result = await db.query(
    `UPDATE feature_discovery 
     SET status = 'dismissed', dismissed_at = NOW()
     WHERE user_id = $1 AND organisation_id = $2 AND feature_id = $3
     RETURNING *`,
    [userId, organisationId, featureId]
  );

  return result.rows[0];
}

/**
 * Mark feature as learned
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {string} featureId - Feature ID
 * @returns {Promise<Object>} Updated feature discovery
 */
async function markFeatureAsLearned(userId, organisationId, featureId) {
  const result = await db.query(
    `UPDATE feature_discovery 
     SET status = 'learned'
     WHERE user_id = $1 AND organisation_id = $2 AND feature_id = $3
     RETURNING *`,
    [userId, organisationId, featureId]
  );

  return result.rows[0];
}

/**
 * Get user feature discoveries
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Feature discovery records
 */
async function getUserFeatureDiscoveries(userId, organisationId, options = {}) {
  const {
    status = 'new',
    limit = 50,
    offset = 0
  } = options;

  const result = await db.query(
    `SELECT * FROM feature_discovery 
     WHERE user_id = $1 AND organisation_id = $2 AND status = $3
     ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
    [userId, organisationId, status, limit, offset]
  );

  return result.rows;
}

/**
 * Record contextual help interaction
 * @param {string} userId - User ID
 * @param {string} organisationId - Organisation ID
 * @param {Object} interaction - Interaction data
 * @returns {Promise<Object>} Created interaction
 */
async function recordHelpInteraction(userId, organisationId, interaction) {
  const {
    help_topic,
    help_type,
    page_context,
    interaction_type,
    helpful,
    feedback,
    metadata = {}
  } = interaction;

  const result = await db.query(
    `INSERT INTO contextual_help_interactions (
      user_id, organisation_id, help_topic, help_type, page_context,
      interaction_type, helpful, feedback, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      userId, organisationId, help_topic, help_type, page_context,
      interaction_type, helpful, feedback, JSON.stringify(metadata)
    ]
  );

  return result.rows[0];
}

/**
 * Get onboarding steps
 * @param {string} organisationId - Organisation ID
 * @param {string} flowType - Flow type
 * @returns {Promise<Array>} Onboarding steps
 */
async function getOnboardingSteps(organisationId, flowType) {
  const result = await db.query(
    `SELECT * FROM onboarding_steps 
     WHERE organisation_id = $1 AND flow_type = $2
     ORDER BY step_number ASC`,
    [organisationId, flowType]
  );

  return result.rows;
}

/**
 * Create onboarding step
 * @param {string} organisationId - Organisation ID
 * @param {Object} step - Step data
 * @returns {Promise<Object>} Created step
 */
async function createOnboardingStep(organisationId, step) {
  const {
    flow_type,
    step_number,
    step_title,
    step_description,
    step_content,
    required = true,
    skippable = true,
    duration_seconds,
    metadata = {}
  } = step;

  const result = await db.query(
    `INSERT INTO onboarding_steps (
      organisation_id, flow_type, step_number, step_title, step_description,
      step_content, required, skippable, duration_seconds, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      organisationId, flow_type, step_number, step_title, step_description,
      JSON.stringify(step_content), required, skippable, duration_seconds, JSON.stringify(metadata)
    ]
  );

  return result.rows[0];
}

/**
 * Get help analytics
 * @param {string} organisationId - Organisation ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Help analytics
 */
async function getHelpAnalytics(organisationId, options = {}) {
  const {
    start_date,
    end_date
  } = options;

  let query = `SELECT 
    help_topic,
    COUNT(*) as total_interactions,
    SUM(CASE WHEN helpful = true THEN 1 ELSE 0 END) as helpful_count,
    SUM(CASE WHEN helpful = false THEN 1 ELSE 0 END) as unhelpful_count
  FROM contextual_help_interactions
  WHERE organisation_id = $1`;
  
  const params = [organisationId];
  let paramIndex = 2;

  if (start_date) {
    query += ` AND created_at >= $${paramIndex}`;
    params.push(start_date);
    paramIndex++;
  }

   if (end_date) {
     query += ` AND created_at <= $${paramIndex}`;
     params.push(end_date);
   }

   query += ` GROUP BY help_topic ORDER BY total_interactions DESC`;

  const result = await db.query(query, params);
  return result.rows;
}

module.exports = {
  getOnboardingProgress,
  upsertOnboardingProgress,
  completeOnboardingStep,
  skipOnboarding,
  getTutorialCompletion,
  startTutorial,
  updateTutorialProgress,
  completeTutorial,
  skipTutorial,
  getUserTutorials,
  getHelpArticles,
  getHelpArticleBySlug,
  createHelpArticle,
  getFeatureDiscovery,
  createFeatureDiscovery,
  dismissFeatureDiscovery,
  markFeatureAsLearned,
  getUserFeatureDiscoveries,
  recordHelpInteraction,
  getOnboardingSteps,
  createOnboardingStep,
  getHelpAnalytics
};
