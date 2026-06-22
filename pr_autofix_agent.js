const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;

  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);

    if (fs.statSync(dirPath).isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'build'].includes(f)) {
        walkDir(dirPath, callback);
      }
    } else {
      if (/\.(js|jsx|ts|tsx)$/.test(f)) callback(dirPath);
    }
  });
}

const ROOT_DIR = path.resolve(__dirname, '..');
const results = [];

function normalizeIndent(line) {
  return line.replace(/\t/g, '  ').match(/^\s*/)[0].length;
}

walkDir(ROOT_DIR, (filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const isFrontend =
    filePath.includes('/frontend/') ||
    filePath.includes('\\frontend\\');

  let score = 0;
  let leakage = [];
  let overEngineering = [];

  // SAFE DETECTION LAYER (frontend logic leakage)
  if (isFrontend) {
    if (/\b(calculate|compute|derive)\b/i.test(content)) {
      score += 10;
      leakage.push("UI contains computation logic keywords.");
    }

    const reduceCount = (content.match(/\.reduce\(/g) || []).length;
    if (reduceCount > 3) {
      score += 10;
      leakage.push(`Heavy use of reduce (${reduceCount}x).`);
    }

    const mathCount = (content.match(/Math\./g) || []).length;
    if (mathCount > 5) {
      score += 10;
      leakage.push("Excessive Math usage in UI layer.");
    }
  }

  // STRUCTURAL COMPLEXITY
  let maxIndent = 0;
  let deepLines = 0;

  for (const line of lines) {
    const indent = normalizeIndent(line);
    if (indent > maxIndent) maxIndent = indent;
    if (indent >= 16) deepLines++;
  }

  if (maxIndent > 24 || deepLines > 15) {
    score += 20;
    overEngineering.push("Deep nesting detected.");
  }

  // BOOLEAN COMPLEXITY (improved heuristic)
  const boolOps = (content.match(/&&/g) || []).length;
  if (boolOps > 6) {
    score += 15;
    overEngineering.push("High boolean chaining complexity.");
  }

  // FILE SIZE
  if (lines.length > 400) {
    score += 25;
    overEngineering.push(`Large file (${lines.length} lines).`);
  }

  // CLAMP SCORE (IMPORTANT)
  score = Math.min(100, score);

  if (score >= 40) {
    results.push({
      file: path.relative(ROOT_DIR, filePath),
      score,
      leakage,
      overEngineering
    });
  }
});

// REPORT
const report = [];

if (results.length === 0) {
  report.push("# PR Auto-Fix Report\n");
  report.push("### FINAL DECISION\nAUTO MERGED");
} else {
  results.sort((a, b) => b.score - a.score);

  report.push("# PR Auto-Fix Report\n");
  report.push("### COMPLEXITY ANALYSIS\n");

  for (const r of results) {
    report.push(`**File:** \`${r.file}\``);
    report.push(`**Score:** ${r.score}`);

    if (r.leakage.length) {
      report.push(`- Leakage: ${r.leakage.join(' ')}`);
    }

    if (r.overEngineering.length) {
      report.push(`- Complexity: ${r.overEngineering.join(' ')}`);
    }

    report.push('');
  }

  const max = results[0].score;
  const decision = max > 80 ? "BLOCKED" : "NEEDS REVIEW";

  report.push("### FINAL DECISION\n**" + decision + "**");
}

fs.writeFileSync(
  path.join(ROOT_DIR, 'pr_autofix_report.md'),
  report.join('\n')
);

console.log("Analyse terminée.");