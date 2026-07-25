const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/organizational-performance.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('organizational performance route contract', () => {
  test('routes all writes through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/transactionalWrite\(req/g)).toHaveLength(7);
    expect(source.match(/client\.query\(/g)).toHaveLength(8);
  });

  test.each([
    'performance.objective.create',
    'performance.indicator.create',
    'performance.measurement.record',
    'performance.review.complete',
    'performance.improvement.transition',
  ])('enforces policy %s', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('uses normalized identity values in policy inputs', () => {
    expect(source).toContain('ownerUserId: req.body.ownerUserId || actor(req)');
    expect(source).toContain('measuredByUserId: req.body.measuredByUserId || actor(req)');
    expect(source).toContain('reviewerUserId: req.body.reviewerUserId || actor(req)');
  });

  test('checks objective ownership under row lock before approval', () => {
    expect(source).toContain('SELECT owner_user_id FROM performance_objectives WHERE id=$1 AND organisation_id=$2 FOR UPDATE');
    expect(source).toContain('performance.objective_independent_approval_required');
  });

  test('persists transaction idempotency for measurements', () => {
    expect(source).toMatch(/performance_measurements[\s\S]*idempotencyKey/);
  });
});
