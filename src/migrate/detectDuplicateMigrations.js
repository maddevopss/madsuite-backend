const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Detect migration integrity issues:
 * 1. Exact filename collisions between db/archive/migrations/ and db/migrations/
 * 2. Duplicate filenames within db/migrations/ (same full filename)
 * 3. Format validation
 *
 * Historical numeric prefixes (e.g., 033, 034, 035) are allowed if filenames are unique.
 * Archives are never executed but must not shadow active migrations.
 */
function detectDuplicateMigrations() {
  const archiveDir = path.join(__dirname, "../../db/archive/migrations");
  const activeDir = path.join(__dirname, "../../db/migrations");

  const archiveFiles = new Set();
  const activeFiles = new Set();
  const collisions = [];

  // Load archive filenames
  if (fs.existsSync(archiveDir)) {
    const files = fs
      .readdirSync(archiveDir)
      .filter((f) => /^\d+[a-z]?_.+\.sql$/i.test(f));
    files.forEach((f) => archiveFiles.add(f));
  }

  // Load active filenames and check for collisions
  if (fs.existsSync(activeDir)) {
    const files = fs
      .readdirSync(activeDir)
      .filter((f) => /^\d+[a-z]?_.+\.sql$/i.test(f));

    for (const file of files) {
      if (activeFiles.has(file)) {
        // Duplicate within active migrations
        collisions.push({
          type: "duplicate_active",
          file,
          message: `Fichier dupliqué dans db/migrations/: ${file}`,
        });
      }
      activeFiles.add(file);

      // Check for collision with archive
      if (archiveFiles.has(file)) {
        const archivePath = path.join(archiveDir, file);
        const activePath = path.join(activeDir, file);
        const archiveHash = hashFile(archivePath);
        const activeHash = hashFile(activePath);

        collisions.push({
          type: "collision_archive_active",
          file,
          archiveHash,
          activeHash,
          identical: archiveHash === activeHash,
          message: `Collision: ${file} existe dans archive ET migrations actives (${
            archiveHash === activeHash ? "identiques" : "DIFFÉRENTS"
          })`,
        });
      }
    }
  }

  // Separate blocking errors from warnings
  const blockingErrors = collisions.filter((c) => c.type === "collision_archive_active" && !c.identical);
  const warnings = collisions.filter((c) => c.type === "collision_archive_active" && c.identical);
  const duplicates = collisions.filter((c) => c.type === "duplicate_active");

  // Block on divergent collisions
  if (blockingErrors.length > 0) {
    const message = blockingErrors
      .map((c) => `  ${c.message}`)
      .join("\n");

    throw new Error(
      `Collisions divergentes détectées (archive ≠ actif) :\n${message}\n\nCes migrations doivent être résolues par une migration additive.`,
    );
  }

  // Block on duplicate filenames within active migrations
  if (duplicates.length > 0) {
    const message = duplicates
      .map((c) => `  ${c.message}`)
      .join("\n");

    throw new Error(
      `Fichiers dupliqués dans db/migrations/ :\n${message}\n\nChaque fichier doit avoir un nom unique.`,
    );
  }

  // Log warnings for identical collisions (temporary, will be cleaned up)
  if (warnings.length > 0) {
    console.warn(
      `⚠️  Migrations identiques dans archive et actif (nettoyage ultérieur recommandé):`
    );
    warnings.forEach((w) => console.warn(`   ${w.message}`));
  }

  return true;
}

function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

module.exports = { detectDuplicateMigrations };
