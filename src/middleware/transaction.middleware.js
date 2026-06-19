const logger = require("../config/logger");

/**
 * Middleware pour gérer les transactions de base de données et libérer le client.
 * Il démarre une transaction, s'assure qu'elle est commitée ou rollbackée
 * en fonction du statut de la réponse, et libère le client de la base de données.
 * Ce middleware doit être placé APRÈS `rlsContextMiddleware`.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function transactionMiddleware(req, res, next) {
  const client = req.dbClient;

  if (!client) {
    logger.error(
      "Transaction Middleware: req.dbClient est manquant. Assurez-vous que rlsContextMiddleware est exécuté avant.",
    );
    return res.status(500).json({ message: "Erreur interne du serveur: Contexte de base de données non préparé." });
  }

  try {
    await client.query("BEGIN");

    // Les listeners s'assureront que le client est libéré et la transaction gérée
    res.on("finish", async () => {
      try {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          await client.query("COMMIT");
        } else {
          await client.query("ROLLBACK");
        }
      } finally {
        client.release();
      }
    });
    next();
  } catch (err) {
    logger.error("Transaction Middleware error: Échec du démarrage de la transaction.", { error: err.message });
    // En cas d'erreur avant next(), le client doit être libéré ici
    client.release();
    res.status(500).json({ message: "Erreur interne du serveur lors de la gestion de la transaction." });
  }
}

module.exports = transactionMiddleware;
