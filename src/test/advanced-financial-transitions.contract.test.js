const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../routes/business/advanced-financial-management.routes.js'), 'utf8');

describe('advanced financial approval transitions', () => {
  test.each([
    "router.post('/budgets/:id/approve'",
    "router.post('/forecasts/:id/publish'",
    "router.post('/scenarios/:id/approve'",
  ])('exposes %s', (route) => expect(source).toContain(route));

  test.each([
    'finance.budget.approve@1',
    'finance.forecast.publish@1',
    'finance.scenario.approve@1',
  ])('applies %s', (policy) => expect(source).toContain(policy));

  test('locks each object and reads its real owner or preparer', () => {
    expect(source.match(/FOR UPDATE/g)).toHaveLength(3);
    expect(source).toContain('owner_user_id');
    expect(source.match(/prepared_by_user_id/g).length).toBeGreaterThanOrEqual(2);
  });
});
