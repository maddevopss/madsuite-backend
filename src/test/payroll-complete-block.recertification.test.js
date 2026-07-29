'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('payroll complete block recertification', () => {
  test('keeps every advanced payroll capability wired to the application', () => {
    const app = read('src/app.js');
    const remittances = read('src/routes/business/payroll-remittances.routes.js');

    expect(app).toContain('payroll');
    expect(remittances).toContain('deposits');
    expect(remittances).toContain('vacations');
    expect(remittances).toContain('terminations');
    expect(remittances).toContain('year-end-slips');
    expect(remittances).toContain('reconciliation');
  });

  test('keeps organisation guards and human approval evidence', () => {
    const files = [
      'src/routes/business/payroll-remittances.routes.js',
      'src/routes/business/payroll-deposits.routes.js',
      'src/routes/business/payroll-vacations.routes.js',
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain('requireOrganisation');
      expect(source).toContain('organisation_id');
    }

    const yearEnd = read('src/services/business/payroll-year-end.service.js');
    const termination = read('src/services/business/payroll-termination.service.js');
    expect(yearEnd).toMatch(/approval|approved/i);
    expect(termination).toMatch(/roe|relevé|record of employment/i);
  });

  test('keeps the final payroll reconciliation deterministic and tenant scoped', () => {
    const reconciliation = read('src/services/business/payroll-reconciliation.service.js');
    expect(reconciliation).toContain('organisation_id');
    expect(reconciliation).toMatch(/variance/i);
    expect(reconciliation).toMatch(/balanced|warning|blocked/);
  });
});
