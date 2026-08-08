// Le snapshot SQL de la baseline peut dépasser les délais applicatifs normaux.
// Ces valeurs ne s'appliquent qu'à cette commande dédiée, avant la création du pool.
process.env.DB_QUERY_TIMEOUT_MS = process.env.BASELINE_DB_QUERY_TIMEOUT_MS || "0";
process.env.DB_STATEMENT_TIMEOUT_MS = process.env.BASELINE_DB_STATEMENT_TIMEOUT_MS || "0";

const { bootstrapBaselineV2 } = require("./bootstrapBaselineV2");
const db = require("../../db");

bootstrapBaselineV2()
  .then((result) => console.log(`Baseline v2 ${result.status}: ${result.version}`))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
    process.exit(process.exitCode || 0);
  });
