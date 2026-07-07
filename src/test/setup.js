const db = require("../../db");
const SupertestTest = require("supertest/lib/test");

const originalThen = SupertestTest.prototype.then;

function exposeApiResponse(response) {
  const body = response?.body;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.success !== "boolean" ||
    typeof body.code !== "string" ||
    !Object.prototype.hasOwnProperty.call(body, "data")
  ) {
    return response;
  }

  response.apiResponse = body;
  if (body.success) {
    response.body = body.data;
  } else if (
    body.errors &&
    typeof body.errors === "object" &&
    !Array.isArray(body.errors) &&
    Object.prototype.hasOwnProperty.call(body.errors, "errors") &&
    body.errors.errors &&
    typeof body.errors.errors === "object"
  ) {
    response.body = {
      ...(body.errors.message ? { message: body.errors.message } : {}),
      ...body.errors.errors,
    };
  } else {
    response.body = body.errors || {};
  }
  return response;
}

SupertestTest.prototype.then = function patchedThen(resolve, reject) {
  return originalThen.call(this, (response) => resolve(exposeApiResponse(response)), reject);
};

/**
 * Nettoyage automatique après chaque fichier de test.
 * On vide les tables de données tout en préservant la structure.
 */
afterAll(async () => {
  try {
    const tables = ["activity_logs", "activity_daily_summary", "business_audit_logs", "time_entries"];

    // TRUNCATE est silencieux si une table n'existe pas (certaines suites peuvent
    // tourner sur un schéma partiel si la DB a été recrée/teardown en cours).
    for (const table of tables) {
      try {
        await db.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
      } catch (err) {
        if (err?.code === "42P01") {
          // relation does not exist
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    console.error("Erreur lors du nettoyage de la DB de test:", err);
  } finally {
    await db.end().catch(() => null);
  }
});
