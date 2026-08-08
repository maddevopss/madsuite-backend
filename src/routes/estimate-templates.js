/**
 * Routes pour les templates de soumissions
 * @module routes/estimate-templates
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const estimateTemplatesService = require('../services/estimate-templates.service');
const logger = require('../observability/logger');

/**
 * GET /api/estimate-templates
 * Récupère tous les templates de l'organisation
 * @returns {Object} { templates: Array }
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const orgId = req.user.organisation_id;
    const templates = await estimateTemplatesService.getTemplates(orgId);
    res.json({ templates });
  } catch (error) {
    logger.error('Error fetching estimate templates', { error });
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

/**
 * GET /api/estimate-templates/:id
 * Récupère un template spécifique
 * @param {number} id - ID du template
 * @returns {Object} { template: Object }
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.user.organisation_id;
    const template = await estimateTemplatesService.getTemplate(id, orgId);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ template });
  } catch (error) {
    logger.error('Error fetching estimate template', { error });
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

/**
 * POST /api/estimate-templates
 * Crée un nouveau template
 * @body {string} name - Nom du template (requis)
 * @body {string} [description] - Description du template
 * @body {Object} [content] - Contenu du template
 * @body {boolean} [is_default] - Si c'est le template par défaut
 * @returns {Object} { template: Object }
 */
router.post('/', requireAuth, requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const { name, description, content, is_default } = req.body;
    const orgId = req.user.organisation_id;
    const userId = req.user.id;

    // Validation
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const template = await estimateTemplatesService.createTemplate(orgId, {
      name,
      description,
      content,
      is_default,
      created_by: userId,
    });

    res.status(201).json({ template });
  } catch (error) {
    logger.error('Error creating estimate template', { error });
    res.status(500).json({ error: 'Failed to create template' });
  }
});

/**
 * PUT /api/estimate-templates/:id
 * Met à jour un template
 * @param {number} id - ID du template
 * @body {string} [name] - Nom du template
 * @body {string} [description] - Description du template
 * @body {Object} [content] - Contenu du template
 * @body {boolean} [is_default] - Si c'est le template par défaut
 * @returns {Object} { template: Object }
 */
router.put('/:id', requireAuth, requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, content, is_default } = req.body;
    const orgId = req.user.organisation_id;

    const template = await estimateTemplatesService.updateTemplate(id, orgId, {
      name,
      description,
      content,
      is_default,
    });

    res.json({ template });
  } catch (error) {
    logger.error('Error updating estimate template', { error });
    res.status(500).json({ error: 'Failed to update template' });
  }
});

/**
 * DELETE /api/estimate-templates/:id
 * Supprime un template
 * @param {number} id - ID du template
 * @returns {Object} { success: boolean }
 */
router.delete('/:id', requireAuth, requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.user.organisation_id;

    await estimateTemplatesService.deleteTemplate(id, orgId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting estimate template', { error });
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

/**
 * GET /api/estimate-templates/default
 * Récupère le template par défaut
 * @returns {Object} { template: Object }
 */
router.get('/default', requireAuth, async (req, res) => {
  try {
    const orgId = req.user.organisation_id;
    const template = await estimateTemplatesService.getDefaultTemplate(orgId);

    if (!template) {
      return res.status(404).json({ error: 'No default template found' });
    }

    res.json({ template });
  } catch (error) {
    logger.error('Error fetching default template', { error });
    res.status(500).json({ error: 'Failed to fetch default template' });
  }
});

/**
 * POST /api/estimate-templates/:id/set-default
 * Définit un template comme défaut
 * @param {number} id - ID du template
 * @returns {Object} { template: Object }
 */
router.post('/:id/set-default', requireAuth, requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.user.organisation_id;

    const template = await estimateTemplatesService.setDefaultTemplate(id, orgId);
    res.json({ template });
  } catch (error) {
    logger.error('Error setting default template', { error });
    res.status(500).json({ error: 'Failed to set default template' });
  }
});

module.exports = router;
