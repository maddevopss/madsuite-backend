const ApiResponse = require("../utils/apiResponse");
const { pool } = require("../../db");

// Middleware pour vérifier qu'un utilisateur est associé à une organisation
// et injecter un client DB configuré pour la Row-Level Security (RLS)
async function requireOrganisation(req, res, next) {
  // On priorise le JWT décodé par le middleware d'auth précédent
  const organisationId = req.user?.organisation_id;

  if (!organisationId) {
    // 403: utilisateur authentifié, mais sans contexte d'organisation exploitable.
    return res.status(403).json(
      ApiResponse.error("ORGANISATION_REQUIRED", {
        message: "Aucune organisation associée à cet utilisateur.",
      }),
    );
  }

  let client;
  try {
    // On réserve un client du pool pour toute la durée de la requête
    client = await pool.connect();

    /**
     * Configuration du contexte RLS.
     * 'true' en 3ème paramètre de set_config rend le paramètre LOCAL à la transaction.
     * Cela garantit que l'ID ne fuite pas vers d'autres requêtes réutilisant la même connexion.
     */
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [organisationId.toString()]);

    // On injecte le client et l'ID dans la requête pour usage dans les contrôleurs
    req.db = client;
    req.organisationId = organisationId;

    // Sécurité supplémentaire : On s'assure que si une transaction est restée ouverte
    // par erreur dans un contrôleur, elle est annulée avant de rendre le client.
    const originalRelease = client.release.bind(client);
    client.release = async (err) => {
      if (err) await client.query('ROLLBACK').catch(() => {});
      originalRelease();
    };

    // Nettoyage : libération automatique du client une fois la réponse envoyée
    let released = false;
    const cleanup = (origin) => {
      if (released) return;
      if (client) {
        client.release();
        client = null;
        released = true;
      }
    };

    res.on("error", cleanup);
    res.on("finish", cleanup);
    res.on("close", cleanup);

    next();
  } catch (err) {
    if (client) client.release();
    next(err);
  }
}

module.exports = { requireOrganisation };
