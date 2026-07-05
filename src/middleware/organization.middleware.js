const ApiResponse = require("../utils/apiResponse");
const db = require("../../db");
const dbStore = require("../utils/dbStore");

function releaseClientOnce({ req, res, client }) {
  let released = false;
  let responseFinished = false;

  async function cleanup(origin) {
    if (released) return;
    released = true;

    const shouldCommit = responseFinished && res.statusCode < 400;

    try {
      if (shouldCommit) {
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }
    } catch (err) {
      // La réponse est déjà terminée dans la majorité des cas; on journalise sans relancer.
      // eslint-disable-next-line no-console
      console.error("RLS context cleanup failed", {
        origin,
        path: req.originalUrl,
        statusCode: res.statusCode,
        error: err.message,
      });
    } finally {
      client.release();
    }
  }

  res.once("finish", () => {
    responseFinished = true;
    void cleanup("finish");
  });

  res.once("close", () => {
    void cleanup(responseFinished ? "close-after-finish" : "close-before-finish");
  });

  res.once("error", () => {
    void cleanup("error");
  });

  return cleanup;
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
