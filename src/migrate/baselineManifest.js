const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dbDir = path.join(__dirname, "../../db");
const manifestPath = path.join(dbDir, "baseline-v2-manifest.json");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getBaselineManifest() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Manifest de baseline v2 invalide: ${error.message}`, { cause: error });
  }

  if (
    manifest.format !== 1 ||
    typeof manifest.version !== "string" ||
    typeof manifest.file !== "string" ||
    typeof manifest.sha256 !== "string"
  ) {
    throw new Error("Manifest de baseline v2 invalide: format, version, file et sha256 sont requis.");
  }

  if (path.isAbsolute(manifest.file) || manifest.file.includes("..")) {
    throw new Error(`Chemin de baseline refusé: ${manifest.file}`);
  }

  const fullPath = path.resolve(dbDir, manifest.file);
  if (!fullPath.startsWith(`${dbDir}${path.sep}`) || !fs.existsSync(fullPath)) {
    throw new Error(`Baseline v2 absente: ${manifest.file}`);
  }

  const actualHash = sha256(fullPath);
  if (actualHash !== manifest.sha256) {
    throw new Error(`Intégrité invalide: ${manifest.file} a été modifiée.`);
  }

  return { ...manifest, fullPath };
}

module.exports = { getBaselineManifest, manifestPath, sha256 };
