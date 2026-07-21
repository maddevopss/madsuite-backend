const fs = require("fs");
const path = require("path");

const originalExistsSync = fs.existsSync.bind(fs);
const snapshotPath = path.resolve(__dirname, "../../db/schema_current.sql");

fs.existsSync = function existsSyncWithoutStaleSnapshot(candidatePath) {
  if (path.resolve(candidatePath) === snapshotPath) {
    return false;
  }

  return originalExistsSync(candidatePath);
};

const { runMigrations } = require("./runMigrations");

runMigrations({ backup: process.env.ENABLE_DB_BACKUP === "1" })
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
