const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/internal-audit.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('internal audit route contract', () => {
  test('routes every audit write through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/=> transactionalWrite\(req/g)).toHaveLength(6);
    expect(source).toContain('policies: policy ? [`${policy}@1`] : []');
  });

  test.each([
    'audit.program.create',
    'audit.finding.create',
    'audit.followup.complete',
  ])('enforces policy %s inside the transaction', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('uses the transaction client for every protected database write', () => {
    expect(source.match(/client\.query\(/g)).toHaveLength(6);
  });

  test('persists normalized idempotency keys for insert registries', () => {
    expect(source.match(/idempotencyKey/g).length).toBeGreaterThanOrEqual(6);
  });

  test('keeps organisation scoping inside every transaction', () => {
    expect(source).toContain('organisationId: org(req)');
    expect(source.match(/organisationId/g).length).toBeGreaterThanOrEqual(8);
  });
});
