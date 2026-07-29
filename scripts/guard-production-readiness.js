const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const corpus = [];

function collect(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.(js|sql|md|yml|yaml|json)$/.test(entry.name)) corpus.push(fs.readFileSync(full, 'utf8'));
  }
}

collect(path.join(root, 'src'));
collect(path.join(root, 'docs'));
collect(path.join(root, '.github'));
const text = corpus.join('\n');

const checks = [
  ['santé applicative', /health|readiness/i],
  ['migrations contrôlées', /migration|migrate/i],
  ['sauvegarde ou restauration', /backup|restore|restauration|sauvegarde/i],
  ['surveillance', /metrics|prometheus|sentry|observability|monitor/i],
  ['retour arrière', /rollback|retour arrière/i],
  ['journalisation', /winston|logger|log/i],
];

const missing = checks.filter(([, re]) => !re.test(text)).map(([name]) => name);
if (missing.length) {
  console.error('Préparation production incomplète :');
  missing.forEach((name) => console.error(`- ${name}`));
  process.exit(1);
}
console.log('Contrat de préparation production présent.');
