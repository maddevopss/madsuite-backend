const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '../routes/business/organizational-performance.routes.js'), 'utf8');
const policy = fs.readFileSync(path.join(__dirname, '../services/business/organizational-performance-transaction.service.js'), 'utf8');

describe('performance server-backed objective approval', () => {
  test('locks and reads the real objective owner', () => {
    expect(route).toContain('SELECT owner_user_id,status FROM performance_objectives WHERE id=$1 AND organisation_id=$2 FOR UPDATE');
  });

  test('passes owner and approver identities into the policy', () => {
    expect(route).toContain('ownerUserId:objective.owner_user_id');
    expect(route).toContain("policy:'performance.objective.approve@1'");
  });

  test('policy no longer trusts approverIsOwner', () => {
    expect(policy).not.toContain('approverIsOwner');
    expect(policy).toContain('String(input.ownerUserId) === String(input.approvedByUserId)');
  });
});
