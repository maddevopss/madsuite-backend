const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/facilities-management.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('facilities management route contract', () => {
  test('routes all writes through the transaction engine', () => {
    expect(source).toMatch(/require\('\.\.\/\.\.\/services\/business\/transaction-engine\.service'\)/);
    expect(source.match(/router\.post\([\s\S]*?transactionalWrite\(req/g)).toHaveLength(8);
    expect(source).toContain('policies: policy ? [`${policy}@1`] : []');
    expect(source.match(/client\.query\(/g).length).toBeGreaterThanOrEqual(7);
  });

  test.each([
    'facilities.site.create',
    'facilities.space.create',
    'facilities.inspection.complete',
    'facilities.transfer.accept',
    'facilities.asset.decommission',
    'facilities.asset.dispose',
  ])('enforces policy %s when the business state requires it', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('keeps draft inspections outside completion policy', () => {
    expect(source).toContain("const completed = (req.body.status || 'completed') === 'completed'");
    expect(source).toContain("completed ? 'facilities.inspection.complete' : null");
  });

  test('keeps pending transfers outside acceptance policy', () => {
    expect(source).toContain("const accepted = Boolean(req.body.acceptedByUserId) || ['accepted', 'completed'].includes(req.body.status)");
    expect(source).toContain("accepted ? 'facilities.transfer.accept' : null");
  });

  test('keeps pending disposals outside approval policy', () => {
    expect(source).toContain("const approved = Boolean(req.body.approvedByUserId) || ['approved', 'disposed', 'completed'].includes(req.body.status)");
    expect(source).toContain("approved ? 'facilities.asset.dispose' : null");
  });

  test('persists transaction idempotency keys for guarded records', () => {
    expect(source).toMatch(/facilities_inspections[\s\S]*idempotencyKey/);
    expect(source).toMatch(/facilities_transfers[\s\S]*idempotencyKey/);
    expect(source).toMatch(/facilities_disposals[\s\S]*idempotencyKey/);
  });
});
