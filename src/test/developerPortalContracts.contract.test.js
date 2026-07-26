'use strict';

const fs = require('fs');
const path = require('path');

const documentPath = path.join(__dirname, '../../docs/integrations/DEVELOPER_PORTAL_CONTRACTS.md');

describe('developer portal contracts', () => {
  test('documents scope, sandbox, errors and compatibility', () => {
    const content = fs.readFileSync(documentPath, 'utf8');
    for (const required of ['organisation', 'environnement', 'permissions', 'Erreurs communes', 'Compatibilité', 'dépréciation']) {
      expect(content).toContain(required);
    }
  });

  test('forbids destructive production tests and unannounced retirement', () => {
    const content = fs.readFileSync(documentPath, 'utf8');
    expect(content).toContain('opérations destructives sont interdites en production');
    expect(content).toContain('Aucun retrait ne peut être effectué');
  });
});
