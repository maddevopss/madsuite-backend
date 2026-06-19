const db = require("../../db");
const { isModuleIncludedInPlan } = require("../config/modules");
const ApiResponse = require("../utils/apiResponse");

/**
 * Middleware Express qui vérifie si l'organisation a accès à un module.
 * 
 * Logique :
 * 1. Si le module est "free" → toujours autorisé
 * 2. Si le plan de l'org couvre le module (ex: "pro" couvre les modules "pro") → autorisé
 * 3. Sinon, vérifie dans organisation_modules si le module est activé en add-on
 * 4. Si aucun accès → 403
 * 
 * Usage :
 *   router.get("/", auth, requireModule("invoices"), handler);
 */
function requireModule(moduleKey) {
  return async (req, res, next) => {
    try {
      const organisationId = req.user?.organisation_id;
      if (!organisationId) {
        return res.status(403).json(ApiResponse.error("MODULE_ACCESS_DENIED", {
          message: "Organisation non identifiée."
        }));
      }

      // 1. Vérifier si le module est inclus dans le plan de l'org
      const orgResult = await db.query(
        "SELECT plan_type FROM organisations WHERE id = $1",
        [organisationId]
      );
      const planType = orgResult.rows[0]?.plan_type || "free";

      if (isModuleIncludedInPlan(moduleKey, planType)) {
        return next();
      }

      // 2. Vérifier si le module est activé en add-on
      const modResult = await db.query(
        "SELECT is_active FROM organisation_modules WHERE organisation_id = $1 AND module_key = $2",
        [organisationId, moduleKey]
      );

      if (modResult.rows[0]?.is_active) {
        return next();
      }

      // 3. Accès refusé
      return res.status(403).json(ApiResponse.error("MODULE_NOT_ENABLED", {
        message: `Le module "${moduleKey}" n'est pas activé pour votre organisation.`,
        module_key: moduleKey
      }));
    } catch (err) {
      console.error("requireModule error:", err);
      return res.status(500).json(ApiResponse.error("SERVER_ERROR", { message: "Erreur serveur" }));
    }
  };
}

/**
 * Version publique (kiosque) : vérifie par organisation_id directement (pas de req.user).
 */
function requireModuleForOrg(moduleKey, organisationId) {
  return async () => {
    try {
      const orgResult = await db.query(
        "SELECT plan_type FROM organisations WHERE id = $1",
        [organisationId]
      );
      const planType = orgResult.rows[0]?.plan_type || "free";

      if (isModuleIncludedInPlan(moduleKey, planType)) return true;

      const modResult = await db.query(
        "SELECT is_active FROM organisation_modules WHERE organisation_id = $1 AND module_key = $2",
        [organisationId, moduleKey]
      );

      return !!modResult.rows[0]?.is_active;
    } catch {
      return false;
    }
  };
}

module.exports = { requireModule, requireModuleForOrg };
