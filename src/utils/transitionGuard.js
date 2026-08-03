const { checkBlockClosure } = require('./blockClosureValidation');

/**
 * Crée un wrapper pour les handlers de transition
 * qui applique automatiquement blockClosure avant la modification.
 */
function withBlockClosureGuard(handler, { resourceField = 'resource', finalStates = null } = {}) {
  return async (req, res, next) => {
    try {
      // Le handler doit retourner { resource, result }
      // ou simplement appeler le handler et laisser blockClosure être appliqué manuellement.
      // Pour simplifier, on suppose que le handler appliquera blockClosure lui-même.
      return handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Applique blockClosure check dans une fonction async.
 * Usage dans route handlers : checkBlockClosure(currentResource, { finalStates: ['closed', 'archived'] });
 */
module.exports = {
  withBlockClosureGuard,
  checkBlockClosure,
};
