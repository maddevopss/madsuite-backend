const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/data-privacy-governance.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('data privacy governance route contract', () => {
  test('routes every write through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/transactionalWrite\(req/g)).toHaveLength(7);
    expect(source).not.toMatch(/db\.pool\.query\(`(?:INSERT|UPDATE|DELETE)/);
  });

  test.each([
    'privacy.processing.create',
    'privacy.consent.record',
    'privacy.subject_request.transition',
    'privacy.incident.record',
    'privacy.incident.close',
    'privacy.retention.complete',
  ])('enforces policy %s', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('normalizes server-derived owners before policy evaluation', () => {
    expect(source).toContain('ownerUserId: req.body.ownerUserId || actor(req)');
  });
});
