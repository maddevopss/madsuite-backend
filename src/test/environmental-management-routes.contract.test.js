const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/environmental-management.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('environmental management route contract', () => {
  test('routes all protected writes through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require(\"../../services/business/transaction-engine.service\")");
    expect(source.match(/=> transactionalWrite\(req/g)).toHaveLength(6);
    expect(source).toContain('policies: [`${policy}@1`]');
  });

  test.each([
    'environment.permit.register',
    'environment.incident.report',
    'environment.inspection.complete',
    'environment.corrective_action.close',
    'environment.metric.record',
    'environment.report.publish',
  ])('enforces policy %s inside the transaction', (policy) => {
    expect(source).toContain(`\"${policy}\"`);
  });

  test('uses the transaction client for every protected database write', () => {
    expect(source.match(/client\.query\(/g)).toHaveLength(6);
  });

  test('does not keep pre-transaction policy evaluation', () => {
    expect(source).not.toContain('evaluatePolicy');
    expect(source).not.toContain('await evaluate(');
  });

  test('keeps organisation scoping inside protected writes', () => {
    expect(source).toContain('organisationId: org(req)');
    expect(source.match(/organisationId/g).length).toBeGreaterThanOrEqual(8);
  });
});
