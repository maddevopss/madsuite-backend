// Middleware pour vérifier les rôles des utilisateurs.
//
// Actuellement, ce middleware vérifie req.user.role.
// Ce rôle est traité comme un rôle applicatif global.
//
// Note future multi-organisation :
// si MADSuite devient un vrai SaaS multi-organisation,
// il faudra probablement distinguer :
// - req.user.role     : rôle global système
// - req.user.role_org : rôle dans l'organisation courante
//
// Exemple futur : requireOrgRole("admin", "manager")
module.exports = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Non authentifié",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Permissions insuffisantes",
      });
    }

    next();
  };
};
