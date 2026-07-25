const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/enterprise-risk.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('enterprise risk route contract', () => {
  test('routes every write through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/transactionalWrite\(req/g)).toHaveLength(7);
    expect(source).not.toMatch(/db\.pool\.query\(`(?:INSERT|UPDATE|DELETE)/);
  });

  test.each([
    'risk.register.create',
    'risk.assessment.record',
    'risk.control.transition',
    'risk.treatment.transition',
    'risk.review.transition',
    'risk.incident.record',
  ])('references policy %s', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('uses normalized transaction idempotency keys for persisted writes', () => {
    expect(source.match(/idempotencyKey/g).length).toBeGreaterThanOrEqual(6);
  });
});
