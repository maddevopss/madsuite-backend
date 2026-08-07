const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dbDir = path.join(__dirname, "../../db");
const manifestPath = path.join(dbDir, "migration-manifest-v2.json");
const migrationDir = path.join(dbDir, "migrations", "v2");
const transactionControl = /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im;
const unsupportedConstraintSyntax = /ALTER\s+TABLE[\s\S]*?ADD\s+CONSTRAINT\s+IF\s+NOT\s+EXISTS/i;

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath, "utf8")).digest("hex");
}

function getPostBaselineMigrations(baselineVersion) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Manifest post-baseline v2 invalide: ${error.message}`);
  }

  if (manifest.format !== 1 || manifest.baseline !== baselineVersion || !Array.isArray(manifest.migrations)) {
    throw new Error("Manifest post-baseline v2 invalide ou associé à la mauvaise baseline.");
  }

  const migrations = manifest.migrations.map((entry) => {
    const [relativePath, expectedHash] = Array.isArray(entry) ? entry : [];
    if (typeof relativePath !== "string" || typeof expectedHash !== "string") {
      throw new Error("Entrée post-baseline v2 invalide.");
    }
    if (!/^migrations\/v2\/\d+_.+\.sql$/.test(relativePath) || relativePath.includes("..")) {
      throw new Error(`Chemin post-baseline v2 refusé: ${relativePath}`);
    }
    const fullPath = path.resolve(dbDir, relativePath);
    if (!fs.existsSync(fullPath) || sha256(fullPath) !== expectedHash) {
      throw new Error(`Intégrité post-baseline v2 invalide: ${relativePath}`);
    }
    const sql = fs.readFileSync(fullPath, "utf8");
    if (transactionControl.test(sql)) {
      throw new Error(`Transaction top-level interdite en v2: ${relativePath}`);
    }
    if (unsupportedConstraintSyntax.test(sql)) {
      throw new Error(`ADD CONSTRAINT IF NOT EXISTS interdit en v2: ${relativePath}`);
    }
    return { file: path.basename(fullPath), fullPath, relativePath, execution: "runner-managed", isArchive: false };
  });

  const declared = new Set(migrations.map((migration) => migration.relativePath));
  const onDisk = fs.existsSync(migrationDir)
    ? fs.readdirSync(migrationDir).filter((file) => /^\d+_.+\.sql$/.test(file)).map((file) => `migrations/v2/${file}`)
    : [];
  const unknown = onDisk.filter((file) => !declared.has(file));
  if (unknown.length) {
    throw new Error(`Migration v2 non déclarée: ${unknown.join(", ")}`);
  }

  return migrations;
}

module.exports = { getPostBaselineMigrations, manifestPath };
