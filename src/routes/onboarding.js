/**
 * Onboarding Routes
 * API endpoints for onboarding, tutorials, help system, and feature discovery
 * @module routes/onboarding
 */

const express = require('express');
const router = express.Router();
const onboardingService = require('../services/onboarding.service');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');

// Middleware
router.use(authenticate);

/**
 * GET /api/onboarding/progress
 * Get onboarding progress for a specific flow
 */
router.get('/progress', validateRequest({
  query: {
    flow_type: { type: 'string', required: true }
  }
}), async (req, res) => {
  try {
    const { flow_type } = req.query;
    const { userId, organisationId } = req.user;

    const progress = await onboardingService.getOnboardingProgress(
      userId,
      organisationId,
      flow_type
    );

    res.json(progress || { status: 'not_started' });
  } catch (error) {
    console.error('Error fetching onboarding progress:', error);
    res.status(500).json({ error: 'Failed to fetch onboarding progress' });
  }
});

/**
 * POST /api/onboarding/start
 * Start onboarding flow
 */
router.post('/start', validateRequest({
  body: {
    flow_type: { type: 'string', required: true },
    total_steps: { type: 'number', default: 5 }
  }
}), async (req, res) => {
  try {
    const { flow_type, total_steps } = req.body;
    const { userId, organisationId } = req.user;

    const progress = await onboardingService.upsertOnboardingProgress(
      userId,
      organisationId,
      {
        flow_type,
        current_step: 1,
        total_steps,
        status: 'in_progress'
      }
    );

    res.status(201).json(progress);
  } catch (error) {
    console.error('Error starting onboarding:', error);
    res.status(500).json({ error: 'Failed to start onboarding' });
  }
});

/**
 * POST /api/onboarding/complete-step
 * Complete an onboarding step
 */
router.post('/complete-step', validateRequest({
  body: {
    flow_type: { type: 'string', required: true },
    step_number: { type: 'number', required: true }
  }
}), async (req, res) => {
  try {
    const { flow_type, step_number } = req.body;
    const { userId, organisationId } = req.user;

    const progress = await onboardingService.completeOnboardingStep(
      userId,
      organisationId,
      flow_type,
      step_number
    );

    res.json(progress);
  } catch (error) {
    console.error('Error completing onboarding step:', error);
    res.status(500).json({ error: 'Failed to complete onboarding step' });
  }
});

/**
 * POST /api/onboarding/skip
 * Skip onboarding flow
 */
router.post('/skip', validateRequest({
  body: {
    flow_type: { type: 'string', required: true }
  }
}), async (req, res) => {
  try {
    const { flow_type } = req.body;
    const { userId, organisationId } = req.user;

    const progress = await onboardingService.skipOnboarding(
      userId,
      organisationId,
      flow_type
    );

    res.json(progress);
  } catch (error) {
    console.error('Error skipping onboarding:', error);
    res.status(500).json({ error: 'Failed to skip onboarding' });
  }
});

/**
 * GET /api/tutorials
 * Get user tutorials
 */
router.get('/tutorials', validateRequest({
  query: {
    status: { type: 'string' },
    category: { type: 'string' },
    limit: { type: 'number', default: 50 },
    offset: { type: 'number', default: 0 }
  }
}), async (req, res) => {
  try {
    const { status, category, limit, offset } = req.query;
    const { userId, organisationId } = req.user;

    const tutorials = await onboardingService.getUserTutorials(
      userId,
      organisationId,
      { status, category, limit, offset }
    );

    res.json(tutorials);
  } catch (error) {
    console.error('Error fetching tutorials:', error);
    res.status(500).json({ error: 'Failed to fetch tutorials' });
  }
});

/**
 * POST /api/tutorials/start
 * Start a tutorial
 */
router.post('/tutorials/start', validateRequest({
  body: {
    tutorial_id: { type: 'string', required: true },
    tutorial_title: { type: 'string', required: true },
    tutorial_category: { type: 'string' }
  }
}), async (req, res) => {
  try {
    const { tutorial_id, tutorial_title, tutorial_category } = req.body;
    const { userId, organisationId } = req.user;

    const tutorial = await onboardingService.startTutorial(
      userId,
      organisationId,
      { tutorial_id, tutorial_title, tutorial_category }
    );

    res.status(201).json(tutorial);
  } catch (error) {
    console.error('Error starting tutorial:', error);
    res.status(500).json({ error: 'Failed to start tutorial' });
  }
});

/**
 * PUT /api/tutorials/:tutorialId/progress
 * Update tutorial progress
 */
router.put('/tutorials/:tutorialId/progress', validateRequest({
  body: {
    progress_percentage: { type: 'number', required: true }
  }
}), async (req, res) => {
  try {
    const { tutorialId } = req.params;
    const { progress_percentage } = req.body;
    const { userId, organisationId } = req.user;

    const tutorial = await onboardingService.updateTutorialProgress(
      userId,
      organisationId,
      tutorialId,
      progress_percentage
    );

    res.json(tutorial);
  } catch (error) {
    console.error('Error updating tutorial progress:', error);
    res.status(500).json({ error: 'Failed to update tutorial progress' });
  }
});

/**
 * POST /api/tutorials/:tutorialId/complete
 * Complete a tutorial
 */
router.post('/tutorials/:tutorialId/complete', async (req, res) => {
  try {
    const { tutorialId } = req.params;
    const { userId, organisationId } = req.user;

    const tutorial = await onboardingService.completeTutorial(
      userId,
      organisationId,
      tutorialId
    );

    res.json(tutorial);
  } catch (error) {
    console.error('Error completing tutorial:', error);
    res.status(500).json({ error: 'Failed to complete tutorial' });
  }
});

/**
 * POST /api/tutorials/:tutorialId/skip
 * Skip a tutorial
 */
router.post('/tutorials/:tutorialId/skip', async (req, res) => {
  try {
    const { tutorialId } = req.params;
    const { userId, organisationId } = req.user;

    const tutorial = await onboardingService.skipTutorial(
      userId,
      organisationId,
      tutorialId
    );

    res.json(tutorial);
  } catch (error) {
    console.error('Error skipping tutorial:', error);
    res.status(500).json({ error: 'Failed to skip tutorial' });
  }
});

/**
 * GET /api/help/articles
 * Get help articles
 */
router.get('/help/articles', validateRequest({
  query: {
    category: { type: 'string' },
    featured: { type: 'boolean' },
    search: { type: 'string' },
    limit: { type: 'number', default: 50 },
    offset: { type: 'number', default: 0 }
  }
}), async (req, res) => {
  try {
    const { category, featured, search, limit, offset } = req.query;
    const { organisationId } = req.user;

    const articles = await onboardingService.getHelpArticles(
      organisationId,
      { category, featured, search, limit, offset }
    );

    res.json(articles);
  } catch (error) {
    console.error('Error fetching help articles:', error);
    res.status(500).json({ error: 'Failed to fetch help articles' });
  }
});

/**
 * GET /api/help/articles/:slug
 * Get help article by slug
 */
router.get('/help/articles/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { organisationId } = req.user;

    const article = await onboardingService.getHelpArticleBySlug(
      organisationId,
      slug
    );

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json(article);
  } catch (error) {
    console.error('Error fetching help article:', error);
    res.status(500).json({ error: 'Failed to fetch help article' });
  }
});

/**
 * POST /api/help/interactions
 * Record help interaction
 */
router.post('/help/interactions', validateRequest({
  body: {
    help_topic: { type: 'string', required: true },
    help_type: { type: 'string' },
    page_context: { type: 'string' },
    interaction_type: { type: 'string' },
    helpful: { type: 'boolean' },
    feedback: { type: 'string' }
  }
}), async (req, res) => {
  try {
    const { help_topic, help_type, page_context, interaction_type, helpful, feedback } = req.body;
    const { userId, organisationId } = req.user;

    const interaction = await onboardingService.recordHelpInteraction(
      userId,
      organisationId,
      { help_topic, help_type, page_context, interaction_type, helpful, feedback }
    );

    res.status(201).json(interaction);
  } catch (error) {
    console.error('Error recording help interaction:', error);
    res.status(500).json({ error: 'Failed to record help interaction' });
  }
});

/**
 * GET /api/features/discovery
 * Get feature discoveries
 */
router.get('/features/discovery', validateRequest({
  query: {
    status: { type: 'string', default: 'new' },
    limit: { type: 'number', default: 50 },
    offset: { type: 'number', default: 0 }
  }
}), async (req, res) => {
  try {
    const { status, limit, offset } = req.query;
    const { userId, organisationId } = req.user;

    const features = await onboardingService.getUserFeatureDiscoveries(
      userId,
      organisationId,
      { status, limit, offset }
    );

    res.json(features);
  } catch (error) {
    console.error('Error fetching feature discoveries:', error);
    res.status(500).json({ error: 'Failed to fetch feature discoveries' });
  }
});

/**
 * POST /api/features/discovery
 * Create feature discovery
 */
router.post('/features/discovery', validateRequest({
  body: {
    feature_id: { type: 'string', required: true },
    feature_name: { type: 'string', required: true },
    feature_description: { type: 'string' },
    feature_category: { type: 'string' }
  }
}), async (req, res) => {
  try {
    const { feature_id, feature_name, feature_description, feature_category } = req.body;
    const { userId, organisationId } = req.user;

    const feature = await onboardingService.createFeatureDiscovery(
      userId,
      organisationId,
      { feature_id, feature_name, feature_description, feature_category }
    );

    res.status(201).json(feature);
  } catch (error) {
    console.error('Error creating feature discovery:', error);
    res.status(500).json({ error: 'Failed to create feature discovery' });
  }
});

/**
 * POST /api/features/discovery/:featureId/dismiss
 * Dismiss feature discovery
 */
router.post('/features/discovery/:featureId/dismiss', async (req, res) => {
  try {
    const { featureId } = req.params;
    const { userId, organisationId } = req.user;

    const feature = await onboardingService.dismissFeatureDiscovery(
      userId,
      organisationId,
      featureId
    );

    res.json(feature);
  } catch (error) {
    console.error('Error dismissing feature discovery:', error);
    res.status(500).json({ error: 'Failed to dismiss feature discovery' });
  }
});

/**
 * POST /api/features/discovery/:featureId/learn
 * Mark feature as learned
 */
router.post('/features/discovery/:featureId/learn', async (req, res) => {
  try {
    const { featureId } = req.params;
    const { userId, organisationId } = req.user;

    const feature = await onboardingService.markFeatureAsLearned(
      userId,
      organisationId,
      featureId
    );

    res.json(feature);
  } catch (error) {
    console.error('Error marking feature as learned:', error);
    res.status(500).json({ error: 'Failed to mark feature as learned' });
  }
});

/**
 * GET /api/help/analytics
 * Get help analytics
 */
router.get('/help/analytics', validateRequest({
  query: {
    start_date: { type: 'string' },
    end_date: { type: 'string' }
  }
}), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const { organisationId } = req.user;

    const analytics = await onboardingService.getHelpAnalytics(
      organisationId,
      { start_date, end_date }
    );

    res.json(analytics);
  } catch (error) {
    console.error('Error fetching help analytics:', error);
    res.status(500).json({ error: 'Failed to fetch help analytics' });
  }
});

module.exports = router;
