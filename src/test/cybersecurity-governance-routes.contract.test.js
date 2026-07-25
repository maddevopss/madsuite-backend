const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/cybersecurity-governance.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('cybersecurity governance route contract', () => {
  test('routes every write through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/transactionalWrite\(req/g)).toHaveLength(8);
    expect(source).not.toMatch(/router\.post\([\s\S]*?db\.pool\.query/);
  });

  test.each([
    'cybersecurity.asset.create',
    'cybersecurity.control.verify',
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
