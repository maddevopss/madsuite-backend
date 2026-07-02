const ApiResponse = require("../utils/apiResponse");

/**
 * Middleware: requireSuperAdmin
 *
 * Restreint l'accès aux super-admins plateforme MADSuite uniquement.
 * Distinct de requireAdmin (admin d'organisation cliente).
 *
 * Séparation des rôles :
 *   - role = 'admin'       → Admin d'organisation cliente (voit ses données métier)
 *   - MASTER_ADMIN_USER_IDS → Super-admin plateforme (voit la santé globale du SaaS)
 *
 * Utilise la même variable d'environnement que master-admin.routes.js
 * pour éviter la duplication de configuration.
 *
 * Future évolution : migrer vers un role = 'super_admin' en DB.
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json(
      ApiResponse.error("UNAUTHORIZED", {
        message: "Authentication required.",
      })
    );
  }

  const masterAdminEnv = process.env.MASTER_ADMIN_USER_IDS;

  if (!masterAdminEnv) {
    // Si la variable n'est pas configurée, bloquer l'accès par défaut (fail-secure)
    return res.status(403).json(
      ApiResponse.error("FORBIDDEN", {
        message: "Accès réservé aux super-admins plateforme. MASTER_ADMIN_USER_IDS non configuré.",
      })
    );
  }

  const superAdminIds = masterAdminEnv
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter(Boolean);

  if (superAdminIds.includes(req.user.id)) {
    return next();
  }

  return res.status(403).json(
    ApiResponse.error("FORBIDDEN", {
      message: "Accès réservé aux super-admins plateforme.",
    })
  );
};

module.exports = requireSuperAdmin;
