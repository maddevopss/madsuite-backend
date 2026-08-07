const { getManifestMigrations } = require("./migrationManifest");

/**
 * Compatibility entry point for callers that previously scanned directories.
 * The manifest now owns duplicate resolution and integrity validation.
 */
function detectDuplicateMigrations() {
  getManifestMigrations();
  return true;
}

module.exports = { detectDuplicateMigrations };
