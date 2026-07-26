const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../routes/business/internal-audit.routes.js'), 'utf8');

describe('internal audit explicit transitions', () => {
  test.each([
    "router.post('/engagements/:id/complete'",
    "router.post('/actions/:id/transition'",
    "router.post('/findings/:id/close'",
  ])('exposes %s', (route) => expect(source).toContain(route));

  test.each([
    'audit.engagement.complete',
    'audit.action.transition',
    'audit.finding.close',
  ])('references policy %s', (policy) => expect(source).toContain(`'${policy}'`));

  test('locks engagement, action, and finding rows', () => {
    expect(source.match(/FOR UPDATE/g)).toHaveLength(3);
  });

  test('counts real open actions before finding closure', () => {
    expect(source).toContain("status NOT IN ('closed','cancelled')");
    expect(source).toContain('openActionsCount');
  });
});
