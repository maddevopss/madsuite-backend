const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targets = ['src', 'scripts', '.github', 'package.json'];
const parts = [];

function collect(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    parts.push(fs.readFileSync(target, 'utf8'));
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.(js|sql|json|yml|yaml|md)$/.test(entry.name)) parts.push(fs.readFileSync(full, 'utf8'));
  }
}

targets.forEach((target) => collect(path.join(root, target)));
const text = parts.join('\n');
const checks = [
  ['authentification JWT', /jsonwebtoken|jwt/i],
  ['rotation ou révocation de session', /refresh_tokens|revoke|rotation/i],
  ['RLS et organisation', /row level security|\bRLS\b|organisation_id/i],
  ['limitation de débit', /rate-limit|rateLimit/i],
  ['en-têtes de sécurité', /helmet|content-security-policy|CSP/i],
  ['CORS explicite', /cors/i],
  ['validation des entrées', /zod|validate|schema/i],
  ['audit et secrets', /audit|secret|private key/i],
];
const missing = checks.filter(([, re]) => !re.test(text)).map(([name]) => name);
if (missing.length) {
  console.error('Contrat de sécurité incomplet :');
  missing.forEach((name) => console.error(`- ${name}`));
  process.exit(1);
}
console.log('Contrat final de sécurité présent.');
