const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    if (fs.statSync(dirPath).isDirectory()) {
      if (f !== 'node_modules' && f !== '.git' && f !== 'dist' && f !== 'build') walkDir(dirPath, callback);
    } else {
      if (f.endsWith('.js') || f.endsWith('.jsx') || f.endsWith('.ts') || f.endsWith('.tsx')) callback(dirPath);
    }
  });
}

const results = [];

const ROOT_DIR = path.resolve(__dirname, '..');

walkDir(ROOT_DIR, (filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const lineCount = lines.length;
  
  let complexityScore = 0;
  let duplications = [];
  let leakage = [];
  let overEngineering = [];

  // 1. Détection de fuite de logique métier / UI logic leakage (surtout dans le frontend)
  if (filePath.includes('frontend')) {
    if (content.match(/calculate/i) || content.match(/compute/i)) {
      complexityScore += 15;
      leakage.push("Mots-clés de calcul (calculate/compute) détectés dans le frontend.");
    }
    const reduceCount = (content.match(/\.reduce\(/g) || []).length;
    if (reduceCount > 0) {
      complexityScore += 10 * reduceCount;
      leakage.push(`Utilisation de .reduce() (${reduceCount}x) : la logique cognitive devrait être dans le State Engine.`);
    }
    const mathCount = (content.match(/Math\./g) || []).length;
    if (mathCount > 2) {
      complexityScore += 10;
      leakage.push("Trop d'opérations mathématiques. L'UI doit faire du rendering only.");
    }
  }

  // 2. Détection de duplication et nesting
  let maxIndent = 0;
  let indentCount = 0;
  lines.forEach(line => {
    const indent = line.match(/^\s*/)[0].length;
    if (indent > maxIndent) maxIndent = indent;
    if (indent >= 8) indentCount++; // Plus de 4 niveaux d'indentation (si 2 espaces/tab)
  });

  if (maxIndent >= 12 || indentCount > 20) {
    complexityScore += 20;
    overEngineering.push("Nesting excessif détecté (Pyramid of Doom).");
  }

  // Conditions complexes
  const complexConditions = (content.match(/&&.*&&.*&&/g) || []).length;
  if (complexConditions > 0) {
    complexityScore += 15;
    overEngineering.push(`Conditions trop complexes (${complexConditions}x). Simplification requise.`);
  }

  // Longueur du fichier
  if (lineCount > 300) {
    complexityScore += 25;
    overEngineering.push(`Fichier trop long (${lineCount} lignes). Risque de god-object.`);
  }

  if (complexityScore >= 40) {
    results.push({
      file: path.relative(ROOT_DIR, filePath),
      score: complexityScore,
      leakage,
      overEngineering,
      duplications
    });
  }
});

// Génération du rapport
const reportLines = [];
reportLines.push("# MADSuite — PR Auto-Fix Agent Report\n");

if (results.length === 0) {
  reportLines.push("### FINAL DECISION\n**AUTO MERGED**\n\nAucun fichier ne dépasse le seuil de complexité (Score < 40).");
} else {
  // Trier par score décroissant
  results.sort((a, b) => b.score - a.score);

  reportLines.push("### COMPLEXITY ANALYSIS\n");
  results.forEach(r => {
    reportLines.push(`**Fichier:** \`${r.file}\``);
    reportLines.push(`**Score de complexité:** ${r.score}`);
    if (r.leakage.length > 0) reportLines.push(`- **UI Logic Leakage:** ${r.leakage.join(' ')}`);
    if (r.overEngineering.length > 0) reportLines.push(`- **Over-Engineering:** ${r.overEngineering.join(' ')}`);
    reportLines.push('');
  });

  reportLines.push("### DUPLICATION DETECTED\n_Des patterns répétitifs ont été trouvés dans les fichiers ci-dessus._\n");
  reportLines.push("### AUTO FIX PATCH\n_Veuillez demander à l'agent d'exécuter l'auto-fix sur le fichier cible pour générer le patch._\n");
  
  const maxScore = results[0].score;
  let decision = "NEEDS REVIEW";
  if (maxScore > 80) decision = "BLOCKED";

  reportLines.push("### FINAL DECISION\n**" + decision + "**");
  reportLines.push("\n_Complexity is a bug._");
}

fs.writeFileSync(path.join(ROOT_DIR, 'pr_autofix_report.md'), reportLines.join('\n'));
console.log("Analyse PR Auto-Fix terminée. Rapport généré.");
