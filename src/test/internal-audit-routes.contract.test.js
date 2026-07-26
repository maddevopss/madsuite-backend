const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/internal-audit.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('internal audit route contract', () => {
  test('routes every audit write through the transaction engine', () => {
    expect(source).toMatch(/require\('\.\.\/\.\.\/services\/business\/transaction-engine\.service'\)/);
    expect(source.match(/transactionalWrite\(req/g).length).toBeGreaterThanOrEqual(9);
    expect(source).not.toMatch(/db\.pool\.query\(`(?:INSERT|UPDATE|DELETE)/);
  });

  test.each([
    'audit.program.create',
    'audit.engagement.complete',
    'audit.finding.create',
    'audit.finding.close',
    'audit.action.transition',
    'audit.followup.complete',
  ])('enforces policy %s inside the transaction', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('uses the transaction client for protected database work', () => {
    expect(source.match(/client\.query\(/g).length).toBeGreaterThanOrEqual(12);
    expect(source).toContain('FOR UPDATE');
  });

  test('persists normalized idempotency keys for insert registries', () => {
    expect(source.match(/idempotencyKey/g).length).toBeGreaterThanOrEqual(6);
  });

  test('keeps organisation scoping inside every transaction', () => {
    expect(source).toContain('organisationId: org(req)');
    expect(source.match(/organisationId/g).length).toBeGreaterThanOrEqual(8);
  });
});
