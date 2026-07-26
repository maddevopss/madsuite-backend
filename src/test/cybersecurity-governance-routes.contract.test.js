const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/cybersecurity-governance.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('cybersecurity governance route contract', () => {
  test('routes every write through the transaction engine', () => {
    expect(source).toMatch(/require\('\.\.\/\.\.\/services\/business\/transaction-engine\.service'\)/);
    expect(source.match(/transactionalWrite\(req/g)).toHaveLength(10);
    expect(source).not.toMatch(/db\.pool\.query\(`(?:INSERT|UPDATE|DELETE)/);
  });

  test.each([
    'cybersecurity.asset.create',
    'cybersecurity.control.verify',
    'cybersecurity.vulnerability.transition',
    'cybersecurity.incident.record',
    'cybersecurity.incident.close',
    'cybersecurity.access_review.complete',
    'cybersecurity.exercise.record',
  ])('enforces policy %s', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('keeps initial control and vulnerability creation transactional without fake transitions', () => {
    expect(source).toContain("'cybersecurity.control.create', null");
    expect(source).toContain("'cybersecurity.vulnerability.create', null");
  });
});
