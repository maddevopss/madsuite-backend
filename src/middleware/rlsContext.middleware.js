const db = require("../../db");
const logger = require("../config/logger");
const dbStore = require("../utils/dbStore");

/**
 * Middleware pour établir le contexte Row-Level Security (RLS) pour la requête.
 * Il acquiert un client de la base de données, définit la variable de session
 * `app.current_organisation_id` et passe ce client aux gestionnaires de route.
 * Le client est ensuite géré (transaction et libération) par un middleware ultérieur.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function rlsContextMiddleware(req, res, next) {
  const organisationId = req.user?.organisation_id; // Assumes req.user is populated by an auth middleware

  if (!organisationId) {
    logger.warn("RLS: Requête sans organisationId pour un utilisateur authentifié.", { userId: req.user?.id });
    return res.status(403).json({ message: "Accès refusé: Contexte d'organisation manquant." });
  }

  const client = await db.connect();

  // dbStore.run crée un contexte isolé pour cette requête
  dbStore.run({ dbClient: client, organisationId }, () => {
    client
      .query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationId)])
      .then(() => {
        req.dbClient = client;
        next();
      })
      .catch((err) => {
        logger.error("RLS Middleware error", { error: err.message });
        client.release();
        res.status(500).json({ message: "Erreur RLS" });
      });
  });
}

module.exports = rlsContextMiddleware;
