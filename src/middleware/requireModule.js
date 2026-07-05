const db = require("../../db");
const { MODULES, isModuleIncludedInPlan } = require("../config/modules");
const ApiResponse = require("../utils/apiResponse");

function currentOrganisationId(req) {
  return req.organisationId || req.user?.organisation_id;
}

function denyModuleAccess(res, moduleKey) {
  return res.status(403).json(ApiResponse.error("MODULE_NOT_AVAILABLE", {
    message: `Le module "${moduleKey}" n'est pas disponible pour cette organisation.`,
    module_key: moduleKey,
  }));
}

/**
 * Middleware Express qui vérifie si l'organisation a accès à un module.
 *
 * Logique :
 * 1. Le module doit exister dans le registre central.
 * 2. Si le plan de l'organisation couvre le module, l'accès est autorisé.
 * 3. Sinon, vérifie dans organisation_modules si le module est activé explicitement.
 * 4. Si aucun accès, retourne 403.
 *
 * Usage :
 *   router.get("/", auth, requireOrganisation, requireModule("invoices"), handler);
 */
function requireModule(moduleKey) {
  if (!MODULES[moduleKey]) {
    throw new Error(`Unknown MADSuite module: ${moduleKey}`);
  }

  return async (req, res, next) => {
    try {
      const organisationId = currentOrganisationId(req);
      if (!organisationId) {
        return res.status(403).json(ApiResponse.error("ORGANISATION_REQUIRED", {
          message: "Contexte organisation requis.",
        }));
      }

      const orgResult = await db.query(
        "SELECT plan_type FROM organisations WHERE id = $1",
        [organisationId]
      );
      const planType = orgResult.rows[0]?.plan_type || "free";

      if (isModuleIncludedInPlan(moduleKey, planType)) {
        return next();
      }

      const modResult = await db.query(
        "SELECT is_active FROM organisation_modules WHERE organisation_id = $1 AND module_key = $2 LIMIT 1",
        [organisationId, moduleKey]
      );

      if (modResult.rows[0]?.is_active === true) {
        return next();
      }

      return denyModuleAccess(res, moduleKey);
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Version publique (kiosque) : vérifie par organisation_id directement (pas de req.user).
 */
function requireModuleForOrg(moduleKey, organisationId) {
  if (!MODULES[moduleKey]) {
    throw new Error(`Unknown MADSuite module: ${moduleKey}`);
  }

  return async () => {
    try {
      const orgResult = await db.query(
        "SELECT plan_type FROM organisations WHERE id = $1",
        [organisationId]
      );
      const planType = orgResult.rows[0]?.plan_type || "free";

      if (isModuleIncludedInPlan(moduleKey, planType)) return true;

      const modResult = await db.query(
        "SELECT is_active FROM organisation_modules WHERE organisation_id = $1 AND module_key = $2 LIMIT 1",
        [organisationId, moduleKey]
      );

      return modResult.rows[0]?.is_active === true;
    } catch {
      return false;
    }
  };
}

module.exports = { requireModule, requireModuleForOrg };
