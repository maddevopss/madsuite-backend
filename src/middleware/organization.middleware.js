const ApiResponse = require("../utils/apiResponse");
const db = require("../../db");
const dbStore = require("../utils/dbStore");

function releaseClientOnce({ req, res, client }) {
  let finalizationPromise = null;
  let responseEndScheduled = false;
  const originalEnd = res.end.bind(res);

  function logCleanupFailure(origin, err) {
    // eslint-disable-next-line no-console
    console.error("RLS context cleanup failed", {
      origin,
      path: req.originalUrl,
      statusCode: res.statusCode,
      error: err.message,
    });
  }

  function finalize({ commit, origin }) {
    if (finalizationPromise) return finalizationPromise;

    finalizationPromise = (async () => {
      try {
        await client.query(commit ? "COMMIT" : "ROLLBACK");
      } catch (err) {
        if (commit) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // La connexion sera libérée même si le rollback de secours échoue.
          }
        }
        throw err;
      } finally {
        client.release();
      }
    })();

    finalizationPromise.catch((err) => logCleanupFailure(origin, err));
    return finalizationPromise;
  }

  // Une réponse de succès ne doit jamais être visible avant que sa transaction
  // soit réellement commitée. Sinon une requête immédiatement suivante peut
  // observer un état ancien malgré le 2xx déjà reçu par le client.
  res.end = function endAfterTransaction(chunk, encoding, callback) {
    if (responseEndScheduled) return res;
    responseEndScheduled = true;

    const shouldCommit = res.statusCode < 400;

    void finalize({ commit: shouldCommit, origin: "before-end" })
      .then(() => {
        originalEnd(chunk, encoding, callback);
      })
      .catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          const payload = JSON.stringify(
            ApiResponse.error("TRANSACTION_FINALIZATION_FAILED", {
              message: "La transaction n'a pas pu être finalisée.",
            }),
          );
          originalEnd(payload, "utf8", callback);
          return;
        }

        originalEnd(chunk, encoding, callback);
      });

    return res;
  };

  // Si la connexion HTTP disparaît avant res.end(), aucune donnée partielle ne
  // doit survivre. Les événements normaux après res.end() réutilisent la même
  // promesse et ne peuvent donc pas libérer deux fois la connexion.
  res.once("close", () => {
    if (!responseEndScheduled) {
      void finalize({ commit: false, origin: "close-before-end" });
    }
  });

  res.once("error", () => {
    if (!responseEndScheduled) {
      void finalize({ commit: false, origin: "response-error" });
    }
  });

  return finalize;
}

// Middleware pour vérifier qu'un utilisateur est associé à une organisation
// et injecter un client DB transactionnel configuré pour la Row-Level Security (RLS).
async function requireOrganisation(req, res, next) {
  const organisationId = req.user?.organisation_id;

  if (!organisationId) {
    return res.status(403).json(
      ApiResponse.error("ORGANISATION_REQUIRED", {
        message: "Aucune organisation associée à cet utilisateur.",
      }),
    );
  }

  let client;

  try {
    client = await db.pool.connect();

    // SET LOCAL ne survit que dans une transaction explicite.
    // Sans BEGIN, la valeur locale serait perdue dès la fin du SELECT set_config.
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationId)]);

    req.db = client;
    req.organisationId = organisationId;

    releaseClientOnce({ req, res, client });

    return dbStore.run(
      {
        dbClient: client,
        organisationId,
      },
      () => next(),
    );
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure during setup
      }
      client.release();
    }

    return next(err);
  }
}

module.exports = { requireOrganisation };
