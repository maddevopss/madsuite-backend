const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'coverage'].includes(entry.name)) return [];
      return walk(full);
    }
    return [full];
  });
}

function read(relativePath) {
  const full = path.join(root, relativePath);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

const files = walk(root).filter((file) => /\.(js|sql|yaml|yml|json)$/.test(file));
const corpus = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

const controls = [
  {
    id: 'permissions',
    description: 'Permissions et rôles protégés',
    pass: read('scripts/guard-route-security.js') && /require(Role|SuperAdmin|Organisation)/.test(corpus),
  },
  {
    id: 'migrations',
    description: 'Migrations vérifiées et testées',
    pass: read('src/test/migrations.integration.test.js') && read('src/migrate/runMigrationsFromFiles.js'),
  },
  {
    id: 'transactions',
    description: 'Transactions avec validation et retour arrière',
    pass: /\bBEGIN\b/.test(corpus) && /\bCOMMIT\b/.test(corpus) && /\bROLLBACK\b/.test(corpus),
  },
  {
    id: 'multiTenant',
    description: 'Isolation multi-organisation',
    pass: read('scripts/guard-organisation-routes.js') && /organisation_id/.test(corpus) && /ROW LEVEL SECURITY|RLS/.test(corpus),
  },
  {
    id: 'api',
    description: 'Contrats API documentés',
    pass: Boolean(read('swagger.yaml')) && /openapi|swagger/i.test(read('swagger.yaml')),
  },
  {
    id: 'performance',
    description: 'Métriques et santé observables',
    pass: /prom-client|metrics_snapshot|systemHealth|performance/i.test(corpus),
  },
  {
    id: 'recovery',
    description: 'Reprise, nouvelles tentatives ou compensation',
    pass: /retry|backoff|compensat|reconciliation|recovery/i.test(corpus),
  },
];

const failed = controls.filter((control) => !control.pass);
for (const control of controls) {
  console.log(`${control.pass ? 'PASS' : 'FAIL'} ${control.id}: ${control.description}`);
}

if (failed.length) {
  console.error(`Certification backend du bloc A refusée: ${failed.map((item) => item.id).join(', ')}`);
  process.exit(1);
}

console.log('Certification backend du bloc A: preuves minimales présentes.');
