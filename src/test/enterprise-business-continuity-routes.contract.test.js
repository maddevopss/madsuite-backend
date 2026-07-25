const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/enterprise-business-continuity.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('enterprise business continuity route contract', () => {
  test('routes every write through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/transactionalWrite\(req/g)).toHaveLength(9);
    expect(source).not.toMatch(/router\.post\([\s\S]*?db\.pool\.query/);
  });

  test.each([
    'continuity.process.create',
    'continuity.plan.create',
    'continuity.plan.activate',
    'continuity.exercise.record',
    'continuity.event.record',
    'continuity.event.close',
    'continuity.review.complete',
  ])('enforces policy %s', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('keeps dependency and procedure creation transactional without invented policies', () => {
    expect(source).toContain("'continuity.dependency.create', null");
    expect(source).toContain("'continuity.procedure.create', null");
  });
});
