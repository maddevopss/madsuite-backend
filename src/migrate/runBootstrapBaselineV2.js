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
