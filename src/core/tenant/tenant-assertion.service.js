/**
 * tenant-assertion.service.js
 * 
 * Fournit des méthodes formelles pour s'assurer qu'une ressource en base de données
 * appartient bel et bien à l'organisation (Tenant) spécifiée, AVANT toute mutation.
 */

const { enforceTenant } = require("./tenant-guard.service");

class ResourceOwnershipError extends Error {
  constructor(resource, id) {
    super(`ACCÈS REFUSÉ : La ressource ${resource} (ID: ${id}) n'appartient pas à votre organisation ou n'existe pas.`);
    this.name = "ResourceOwnershipError";
    this.statusCode = 404; // 404 est plus sûr que 403 pour ne pas confirmer l'existence
  }
}

/**
 * Assure qu'une ressource appartient au Tenant.
 * @param {Object} db Le client de base de données
 * @param {string} tableName Le nom de la table
 * @param {number|string} resourceId L'ID de la ressource
 * @param {number|string} organisationId Le Tenant ID
 * @throws {ResourceOwnershipError} Si la ressource n'existe pas ou n'appartient pas à l'organisation
 */
async function assertOwnership(db, tableName, resourceId, organisationId) {
  const orgId = enforceTenant(organisationId);

  // Évite les injections SQL simples sur le nom de table (à utiliser avec des tables connues)
  const safeTableName = tableName.replace(/[^a-z0-9_]/gi, "");

  const query = `SELECT 1 FROM ${safeTableName} WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL LIMIT 1`;
  const result = await db.query(query, [resourceId, orgId]);

  if (result.rows.length === 0) {
    throw new ResourceOwnershipError(safeTableName, resourceId);
  }

  return true;
}

module.exports = {
  assertOwnership,
  ResourceOwnershipError,
};
