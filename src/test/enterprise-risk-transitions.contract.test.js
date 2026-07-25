const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../routes/business/enterprise-risk.routes.js'), 'utf8');

describe('enterprise risk explicit transitions', () => {
  test.each([
    "router.post('/controls/:id/transition'",
    "router.post('/treatments/:id/transition'",
    "router.post('/reviews/:id/transition'",
  ])('exposes %s', (route) => expect(source).toContain(route));

  test.each([
    'risk.control.transition',
    'risk.treatment.transition',
    'risk.review.transition',
  ])('enforces policy %s', (policy) => expect(source).toContain(`'${policy}'`));

  test('locks current rows before changing state', () => {
    expect(source.match(/FOR UPDATE/g)).toHaveLength(3);
  });

  test('does not persist writes through the shared pool', () => {
    expect(source).not.toMatch(/db\.pool\.query\(`(?:INSERT|UPDATE|DELETE)/);
    expect(source.match(/client\.query\(`UPDATE enterprise_risk_(?:controls|treatments|reviews)/g)).toHaveLength(3);
  });
});
