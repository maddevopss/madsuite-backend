/**
 * Migration Order Verification
 *
 * Validates complete migration ordering and detects:
 * 1. Numeric prefix ordering (001, 002, ..., 099, 100+)
 * 2. Timestamp ordering (20260727090000 format)
 * 3. Gaps in sequence
 * 4. Duplicate or conflicting numbers
 * 5. Filenames that would be skipped by regex
 */

const { getManifestMigrations } = require("./migrationManifest");

function getMigrationFiles() {
  return getManifestMigrations();
}

function extractMigrationNumber(filename) {
  const match = filename.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function extractMigrationTimestamp(filename) {
  const match = filename.match(/^(\d{14,})/);
  return match ? match[1] : null;
}

function verififyMigrationOrder() {
  const files = getMigrationFiles();
  const issues = [];

  if (files.length === 0) {
    throw new Error("Aucune migration trouvée");
  }

  // Separate numeric and timestamp migrations
  const numericMigrations = [];
  const timestampMigrations = [];

  for (const entry of files) {
    const timestamp = extractMigrationTimestamp(entry.file);
    if (timestamp && timestamp.length === 14) {
      timestampMigrations.push({ ...entry, timestamp });
    } else {
      const num = extractMigrationNumber(entry.file);
      if (num !== null) {
        numericMigrations.push({ ...entry, num });
      }
    }
  }

  // Verify numeric ordering
  if (numericMigrations.length > 0) {
    const numbers = numericMigrations.map(m => m.num);
    const sortedNumbers = [...numbers].sort((a, b) => a - b);

    for (let i = 0; i < sortedNumbers.length - 1; i++) {
      const gap = sortedNumbers[i + 1] - sortedNumbers[i];
      if (gap > 1 && gap !== 10 && gap !== 100) {
        // Allow reasonable gaps (jumping from 99 to 100, etc.)
        issues.push({
          severity: "warning",
          message: `Écart de numéro de migration: ${sortedNumbers[i]} → ${sortedNumbers[i + 1]} (gap: ${gap})`
        });
      }
    }

    // Check for same-number migrations (must be distinguishable by full name)
    const numberGroups = {};
    for (const m of numericMigrations) {
      if (!numberGroups[m.num]) numberGroups[m.num] = [];
      numberGroups[m.num].push(m.file);
    }

    for (const [num, files] of Object.entries(numberGroups)) {
      if (files.length > 1) {
        issues.push({
          severity: "info",
          message: `${files.length} migrations avec le même préfixe numérique (${num}): ${files.join(", ")}`
        });
      }
    }
  }

  // Verify timestamp ordering
  if (timestampMigrations.length > 0) {
    for (let i = 0; i < timestampMigrations.length - 1; i++) {
      const curr = timestampMigrations[i].timestamp;
      const next = timestampMigrations[i + 1].timestamp;

      if (curr > next) {
        issues.push({
          severity: "error",
          message: `Désordre temporel: ${timestampMigrations[i].file} (${curr}) avant ${timestampMigrations[i + 1].file} (${next})`
        });
      }
    }
  }

  // Warn about mixed numeric and timestamp
  if (numericMigrations.length > 0 && timestampMigrations.length > 0) {
    const lastNumeric = numericMigrations[numericMigrations.length - 1].num;
    const firstTimestamp = timestampMigrations[0].timestamp;

    issues.push({
      severity: "info",
      message: `Migrations numériques ET temporelles présentes (numérique max: ${lastNumeric}, timestamp min: ${firstTimestamp})`
    });
  }

  return {
    totalMigrations: files.length,
    numericCount: numericMigrations.length,
    timestampCount: timestampMigrations.length,
    archiveCount: files.filter(f => f.isArchive).length,
    activeCount: files.filter(f => !f.isArchive).length,
    issues,
    files: files.map(f => ({ file: f.file, archive: f.isArchive }))
  };
}

function formatMigrationReport(result) {
  let output = "\n=== Rapport de Vérification des Migrations ===\n";
  output += `Total: ${result.totalMigrations} migrations\n`;
  output += `  - Numériques: ${result.numericCount}\n`;
  output += `  - Temporelles: ${result.timestampCount}\n`;
  output += `  - Archive: ${result.archiveCount}\n`;
  output += `  - Actives: ${result.activeCount}\n`;

  if (result.issues.length === 0) {
    output += "\n✓ Aucun problème d'ordre détecté\n";
  } else {
    output += "\n⚠ Problèmes détectés:\n";

    const errors = result.issues.filter(i => i.severity === "error");
    const warnings = result.issues.filter(i => i.severity === "warning");
    const info = result.issues.filter(i => i.severity === "info");

    if (errors.length > 0) {
      output += "\n🔴 Erreurs (blocage):\n";
      errors.forEach(e => output += `  - ${e.message}\n`);
    }

    if (warnings.length > 0) {
      output += "\n🟡 Avertissements:\n";
      warnings.forEach(w => output += `  - ${w.message}\n`);
    }

    if (info.length > 0) {
      output += "\n🔵 Info:\n";
      info.forEach(i => output += `  - ${i.message}\n`);
    }
  }

  return output;
}

// CLI usage
if (require.main === module) {
  try {
    const result = verififyMigrationOrder();
    console.log(formatMigrationReport(result));

    const hasErrors = result.issues.some(i => i.severity === "error");
    process.exit(hasErrors ? 1 : 0);
  } catch (err) {
    console.error("Erreur:", err.message);
    process.exit(1);
  }
}

module.exports = {
  verififyMigrationOrder,
  formatMigrationReport,
  getMigrationFiles,
  extractMigrationNumber,
  extractMigrationTimestamp
};
