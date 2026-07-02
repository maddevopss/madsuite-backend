/**
 * Middleware: requireOrganisation
 * 
 * P0 SECURITY: Vérifie que l'utilisateur appartient à l'organisation demandée.
 * Empêche les data leaks inter-organisations.
 * 
 * Usage: router.use(requireOrganisation);
 * 
 * Context:
 * - req.user.id: user ID (défini par auth middleware)
 * - req.user.organisation_id: org ID de l'user (défini par auth middleware)
 * - req.params.organisationId: org ID demandée dans la route
 * - req.body.organisationId: org ID demandée dans le body (fallback)
 */

const ApiResponse = require("../utils/apiResponse");

function requireOrganisation(req, res, next) {
  // Vérifier que l'user est authentifié
  if (!req.user || !req.user.id) {
    return res.status(401).json(ApiResponse.error("UNAUTHORIZED", {
      message: "Authentication required",
    }));
  }

  // Récupérer l'org ID demandée (priorité: params > body > query)
  const requestedOrgId = 
    req.params.organisationId || 
    req.body.organisationId || 
    req.query.organisationId;

  // Vérifier qu'une org est demandée
  if (!requestedOrgId) {
    return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
      message: "Organisation ID is required",
    }));
  }

  // Vérifier que l'user appartient à cette organisation
  if (req.user.organisation_id !== parseInt(requestedOrgId, 10)) {
    console.warn(
      `SECURITY: User ${req.user.id} attempted unauthorized access to org ${requestedOrgId}. ` +
      `User org: ${req.user.organisation_id}`
    );

    return res.status(403).json(ApiResponse.error("FORBIDDEN", {
      message: "Access denied to this organisation",
    }));
  }

  // Tout est bon, passer au handler suivant
  next();
}

module.exports = requireOrganisation;