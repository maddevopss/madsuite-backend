/**
 * Service pour gérer les templates de soumissions
 * @module services/estimate-templates
 */

const db = require('../core/db');
const logger = require('../observability/logger');

/**
 * Récupère tous les templates de l'organisation
 * @param {number} orgId - ID de l'organisation
 * @returns {Promise<Array>} Liste des templates
 * @throws {Error} Si la requête échoue
 */
async function getTemplates(orgId) {
  try {
    const result = await db.query(
      `SELECT id, name, description, content, is_default, created_by, created_at, updated_at
       FROM estimate_templates
       WHERE organisation_id = $1
       ORDER BY is_default DESC, created_at DESC`,
      [orgId]
    );
    return result.rows;
  } catch (error) {
    logger.error('Error fetching estimate templates', { orgId, error });
    throw error;
  }
}

/**
 * Récupère un template spécifique
 * @param {number} templateId - ID du template
 * @param {number} orgId - ID de l'organisation
 * @returns {Promise<Object|null>} Template ou null si non trouvé
 * @throws {Error} Si la requête échoue
 */
async function getTemplate(templateId, orgId) {
  try {
    const result = await db.query(
      `SELECT id, name, description, content, is_default, created_by, created_at, updated_at
       FROM estimate_templates
       WHERE id = $1 AND organisation_id = $2`,
      [templateId, orgId]
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error fetching estimate template', { templateId, orgId, error });
    throw error;
  }
}

/**
 * Crée un nouveau template
 * @param {number} orgId - ID de l'organisation
 * @param {Object} data - Données du template
 * @param {string} data.name - Nom du template
 * @param {string} [data.description] - Description du template
 * @param {Object} [data.content] - Contenu du template
 * @param {boolean} [data.is_default] - Si c'est le template par défaut
 * @param {number} [data.created_by] - ID de l'utilisateur qui crée
 * @returns {Promise<Object>} Template créé
 * @throws {Error} Si la requête échoue
 */
async function createTemplate(orgId, data) {
  const { name, description, content, is_default, created_by } = data;

  try {
    // Validation
    if (!name || name.trim().length === 0) {
      throw new Error('Template name is required');
    }

    // Si is_default = true, désactiver les autres
    if (is_default) {
      await db.query(
        `UPDATE estimate_templates SET is_default = FALSE WHERE organisation_id = $1`,
        [orgId]
      );
    }

    const result = await db.query(
      `INSERT INTO estimate_templates (organisation_id, name, description, content, is_default, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, content, is_default, created_by, created_at, updated_at`,
      [orgId, name.trim(), description || null, content || {}, is_default || false, created_by || null]
    );

    logger.info('Estimate template created', { templateId: result.rows[0].id, orgId, name });
    return result.rows[0];
  } catch (error) {
    logger.error('Error creating estimate template', { orgId, name, error });
    throw error;
  }
}

/**
 * Met à jour un template
 * @param {number} templateId - ID du template
 * @param {number} orgId - ID de l'organisation
 * @param {Object} data - Données à mettre à jour
 * @param {string} [data.name] - Nom du template
 * @param {string} [data.description] - Description du template
 * @param {Object} [data.content] - Contenu du template
 * @param {boolean} [data.is_default] - Si c'est le template par défaut
 * @returns {Promise<Object>} Template mis à jour
 * @throws {Error} Si le template n'existe pas ou si la requête échoue
 */
async function updateTemplate(templateId, orgId, data) {
  const { name, description, content, is_default } = data;

  try {
    // Si is_default = true, désactiver les autres
    if (is_default) {
      await db.query(
        `UPDATE estimate_templates SET is_default = FALSE WHERE organisation_id = $1 AND id != $2`,
        [orgId, templateId]
      );
    }

    const result = await db.query(
      `UPDATE estimate_templates
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           content = COALESCE($3, content),
           is_default = COALESCE($4, is_default),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND organisation_id = $6
       RETURNING id, name, description, content, is_default, created_by, created_at, updated_at`,
      [name, description, content, is_default, templateId, orgId]
    );

    if (result.rows.length === 0) {
      throw new Error('Template not found');
    }

    logger.info('Estimate template updated', { templateId, orgId });
    return result.rows[0];
  } catch (error) {
    logger.error('Error updating estimate template', { templateId, orgId, error });
    throw error;
  }
}

/**
 * Supprime un template
 * @param {number} templateId - ID du template
 * @param {number} orgId - ID de l'organisation
 * @returns {Promise<boolean>} Succès
 * @throws {Error} Si le template n'existe pas ou si la requête échoue
 */
async function deleteTemplate(templateId, orgId) {
  try {
    const result = await db.query(
      `DELETE FROM estimate_templates WHERE id = $1 AND organisation_id = $2`,
      [templateId, orgId]
    );

    if (result.rowCount === 0) {
      throw new Error('Template not found');
    }

    logger.info('Estimate template deleted', { templateId, orgId });
    return true;
  } catch (error) {
    logger.error('Error deleting estimate template', { templateId, orgId, error });
    throw error;
  }
}

/**
 * Récupère le template par défaut
 * @param {number} orgId - ID de l'organisation
 * @returns {Promise<Object|null>} Template par défaut ou null
 * @throws {Error} Si la requête échoue
 */
async function getDefaultTemplate(orgId) {
  try {
    const result = await db.query(
      `SELECT id, name, description, content, is_default, created_by, created_at, updated_at
       FROM estimate_templates
       WHERE organisation_id = $1 AND is_default = TRUE
       LIMIT 1`,
      [orgId]
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error fetching default estimate template', { orgId, error });
    throw error;
  }
}

/**
 * Définit un template comme défaut
 * @param {number} templateId - ID du template
 * @param {number} orgId - ID de l'organisation
 * @returns {Promise<Object>} Template mis à jour
 * @throws {Error} Si le template n'existe pas ou si la requête échoue
 */
async function setDefaultTemplate(templateId, orgId) {
  try {
    // Désactiver tous les autres templates par défaut
    await db.query(
      `UPDATE estimate_templates SET is_default = FALSE WHERE organisation_id = $1`,
      [orgId]
    );

    // Activer ce template comme défaut
    const result = await db.query(
      `UPDATE estimate_templates
       SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organisation_id = $2
       RETURNING id, name, description, content, is_default, created_by, created_at, updated_at`,
      [templateId, orgId]
    );

    if (result.rows.length === 0) {
      throw new Error('Template not found');
    }

    logger.info('Default template set', { templateId, orgId });
    return result.rows[0];
  } catch (error) {
    logger.error('Error setting default template', { templateId, orgId, error });
    throw error;
  }
}

module.exports = {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getDefaultTemplate,
  setDefaultTemplate,
};
