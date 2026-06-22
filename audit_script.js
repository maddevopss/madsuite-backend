const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    if (fs.statSync(dirPath).isDirectory()) {
      if (f !== 'test') walkDir(dirPath, callback);
    } else {
      if (f.endsWith('.js') || f.endsWith('.ts')) callback(dirPath);
    }
  });
}

const results = { safe: [], unsafe: [], critical: [] };

walkDir(path.join(__dirname, 'src'), (filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Mots-clés ORM et SQL
  const unsafePatterns = [
    /db\.query\s*\(\s*(['"`])([\s\S]*?)\1/g,
    /\.(findByPk|findUnique|findOne|findFirst|findMany|update|delete)\s*\(\s*\{([\s\S]*?)\}\s*\)/g,
    /prisma\.\$queryRaw\s*(['"`])([\s\S]*?)\1/g
  ];

  unsafePatterns.forEach(regex => {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const queryStr = match[2] ? match[2].toLowerCase() : match[0].toLowerCase();
      
      const isSafe = queryStr.includes('organisation_id') || 
                     queryStr.includes('tenant_id') || 
                     queryStr.includes('organisationid');

      const linesBefore = content.substring(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const relativePath = path.relative(__dirname, filePath);

      if (isSafe) {
        results.safe.push({ file: relativePath, line: lineNumber });
      } else {
        // Ignorer les commandes transactionnelles
        if (queryStr.includes('begin') && queryStr.length < 15) continue;
        if (queryStr.includes('commit') && queryStr.length < 15) continue;
        if (queryStr.includes('rollback') && queryStr.length < 15) continue;
        
        const preview = queryStr.replace(/\n/g, ' ').substring(0, 100).trim();
        results.unsafe.push({ file: relativePath, line: lineNumber, query: preview });

        // Risque élevé
        if (queryStr.includes('update ') || queryStr.includes('delete ')) {
            results.critical.push({ file: relativePath, line: lineNumber, reason: "Cross-tenant update/delete possible." });
        } else if (queryStr.includes('select ') && !queryStr.includes('where')) {
            results.critical.push({ file: relativePath, line: lineNumber, reason: "Fetch global sans filtrage tenant." });
        }
      }
    }
  });
});

const totalQueries = results.safe.length + results.unsafe.length;
const safetyScore = totalQueries === 0 ? 100 : Math.round((results.safe.length / totalQueries) * 100);

let finalStatus = "SAFE";
if (safetyScore < 100) finalStatus = "MOSTLY SAFE";
if (safetyScore < 90) finalStatus = "AT RISK";
if (results.critical.length > 0 || safetyScore < 75) finalStatus = "CRITICAL";

const report = `
# MADSuite — Multi-Tenant Safety Enforcement Agent

### TENANT SAFETY SCORE
**${safetyScore} / 100**

### FINAL STATUS
**${finalStatus}**

### CRITICAL FINDINGS
${results.critical.length === 0 ? "Aucun problème critique." : results.critical.map(c => `- **[${c.file}:${c.line}]** ${c.reason}`).join('\n')}

### UNSAFE QUERIES
${results.unsafe.map(u => `- **Fichier:** ${u.file}\n  **Ligne:** ${u.line}\n  **Raison:** Manque organisationId dans: \`${u.query}...\``).join('\n\n')}

### SAFE QUERIES
${results.safe.slice(0, 5).map(s => `- **Fichier:** ${s.file} (Ligne: ${s.line})`).join('\n')}${results.safe.length > 5 ? '\n- ...et ' + (results.safe.length - 5) + ' autres' : ''}

### AUTO FIXES
*(Auto fixes suggest using JOINs or explicit organisation_id filtering in the where clause)*
`;

fs.writeFileSync(path.join(__dirname, 'tenant_safety_report.md'), report.trim());
console.log(`Audit terminé. Score: ${safetyScore}/100. Statut: ${finalStatus}`);
