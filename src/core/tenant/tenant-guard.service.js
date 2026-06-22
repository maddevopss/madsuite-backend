/**
 * tenant-guard.service.js
 * 
 * Ce module garantit qu'aucune action métier ne puisse être effectuée sans 
 * un contexte d'organisation (Multi-Tenant).
 */

class TenantError extends Error {
  constructor(message) {
    super(message);
    this.name = "TenantError";
    this.statusCode = 403;
  }
}

/**
 * Valide strictement la présence et la validité d'un organisationId.
 * @param {number|string} organisationId L'ID de l'organisation.
 * @throws {TenantError} Si l'ID est invalide ou manquant.
 * @returns {number} L'ID de l'organisation sécurisé (casté en entier).
 */
function enforceTenant(organisationId) {
  if (!organisationId) {
    throw new TenantError("ACCÈS REFUSÉ : Le contexte d'organisation (Tenant) est manquant. Fuite de données évitée.");
  }

  const parsedId = Number(organisationId);
  if (isNaN(parsedId) || parsedId <= 0) {
    throw new TenantError(`ACCÈS REFUSÉ : Le Tenant ID '${organisationId}' est invalide.`);
  }

  return parsedId;
}

module.exports = {
  enforceTenant,
  TenantError,
};
