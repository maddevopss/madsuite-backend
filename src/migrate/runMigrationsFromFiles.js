const { runMigrations } = require("./runMigrations");

runMigrations({ backup: process.env.ENABLE_DB_BACKUP === "1" })
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
