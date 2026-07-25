const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/advanced-financial-management.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('advanced financial management route contract', () => {
  test('routes every write through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/transactionalWrite\(req/g)).toHaveLength(6);
    expect(source).not.toMatch(/db\.pool\.query\(`(?:INSERT|UPDATE|DELETE)/);
  });

  test('enforces policies compatible with create routes', () => {
    expect(source).toContain("'finance.cash_position.record'");
    expect(source).toContain("'finance.funding_facility.approve'");
  });

  test('does not fabricate transition ids for budgets, forecasts, or scenarios', () => {
    expect(source).toContain("'finance.budget.create', null");
    expect(source).toContain("'finance.forecast.create', null");
    expect(source).toContain("'finance.scenario.create', null");
  });

  test('normalizes server-derived actors before policy evaluation', () => {
    expect(source).toContain('preparedByUserId: req.body.preparedByUserId || actor(req)');
    expect(source).toContain('approvedByUserId: req.body.approvedByUserId || actor(req)');
  });
});
