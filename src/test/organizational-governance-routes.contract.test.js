const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/organizational-governance.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('organizational governance route contract', () => {
  test('routes every write through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/transactionalWrite\(req/g)).toHaveLength(8);
    expect(source).not.toMatch(/router\.post\([\s\S]*?db\.pool\.query/);
  });

  test.each([
    'governance.unit.create',
    'governance.delegation.create',
    'governance.decision.create',
    'governance.conflict.declare',
  ])('enforces compatible policy %s', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('checks decision authorship under row lock before approval', () => {
    expect(source).toContain('SELECT author_user_id FROM governance_decisions WHERE id=$1 AND organisation_id=$2 FOR UPDATE');
    expect(source).toContain('governance.decision_independent_approval_required');
  });

  test('does not fabricate transition identifiers for create routes', () => {
    expect(source).toContain("'governance.committee.meeting.create', null");
    expect(source).toContain("'governance.policy.create', null");
  });
});
