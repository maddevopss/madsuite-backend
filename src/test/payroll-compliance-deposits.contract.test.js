const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/payroll-compliance.routes.js');
const routeSource = fs.readFileSync(routePath, 'utf8');

describe('payroll compliance deposit contract', () => {
  test('uses the payment batch table created by the payroll migration', () => {
    expect(routeSource).toContain('FROM payroll_payment_batches');
    expect(routeSource).not.toContain('FROM payroll_direct_deposit_batches');
  });

  test('derives the confirmation timestamp from the stored confirmation payload', () => {
    expect(routeSource).toContain("confirmation->>'confirmedAt'");
    expect(routeSource).toContain('AS "confirmedAt"');
  });

  test('keeps the query scoped to the authenticated organisation', () => {
    expect(routeSource).toContain('WHERE organisation_id=$1');
  });
});
