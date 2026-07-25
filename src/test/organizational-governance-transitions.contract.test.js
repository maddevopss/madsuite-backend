const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '../routes/business/organizational-governance.routes.js'), 'utf8');
const authority = fs.readFileSync(path.join(__dirname, '../services/business/governance-authority.service.js'), 'utf8');

describe('organizational governance explicit transitions', () => {
  test.each([
    "router.post('/meetings/:id/complete'",
    "router.post('/policies/:id/publish'",
    "router.post('/authority/validate'",
  ])('exposes %s', (signature) => expect(route).toContain(signature));

  test('resolves authority from active delegations and conflicts', () => {
    expect(authority).toContain('FROM governance_delegations');
    expect(authority).toContain('FROM governance_conflicts');
    expect(authority).toContain('FOR UPDATE');
  });

  test('reads real authors and policy owners before approval', () => {
    expect(route).toContain('SELECT id,author_user_id,category FROM governance_decisions');
    expect(route).toContain('SELECT id,owner_user_id FROM governance_policies');
  });

  test.each([
    'governance.committee.meeting.complete@1',
    'governance.decision.approve@1',
    'governance.policy.publish@1',
    'governance.authority.validate@1',
  ])('references %s', (policy) => expect(route).toContain(policy));
});
