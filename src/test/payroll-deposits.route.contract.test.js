'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('Contrat HTTP des lots de dépôts directs', () => {
  test('le routeur est monté avant la route dynamique des remises', () => {
    const remittances = read('routes/business/payroll-remittances.routes.js');
    expect(remittances).toContain("router.use('/deposits', payrollDepositsRoutes)");
    expect(remittances.indexOf("router.use('/deposits'"))
      .toBeLessThan(remittances.indexOf("router.post('/:id/:action'"));
  });

  test('la liste et la création utilisent la table officielle et le contexte organisationnel', () => {
    const routes = read('routes/business/payroll-deposits.routes.js');
    expect(routes).toContain("router.get('/'");
    expect(routes).toContain("router.post('/'");
    expect(routes).toContain('payroll_payment_batches');
    expect(routes).toContain('WHERE b.organisation_id=$1');
    expect(routes).toContain("r.status IN ('approved','paid')");
    expect(routes).toContain('ON CONFLICT (organisation_id,idempotency_key)');
  });

  test('les transitions exigent les preuves nécessaires', () => {
    const routes = read('routes/business/payroll-deposits.routes.js');
    expect(routes).toContain("approve: { from: ['draft'], to: 'approved' }");
    expect(routes).toContain("export: { from: ['approved'], to: 'exported' }");
    expect(routes).toContain("confirm: { from: ['exported'], to: 'confirmed' }");
    expect(routes).toContain("void: { from: ['draft', 'approved', 'exported'], to: 'void' }");
    expect(routes).toContain('L’empreinte du fichier exporté est obligatoire.');
    expect(routes).toContain('Le numéro de confirmation est obligatoire.');
  });
});
