const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../routes/business/institutional-resilience.routes.js');
const source = fs.readFileSync(routePath, 'utf8');

describe('institutional resilience route contract', () => {
  test('routes protected writes through the transaction engine', () => {
    expect(source).toContain("const { executeTransaction } = require('../../services/business/transaction-engine.service')");
    expect(source.match(/transactionalWrite\(req/g)).toHaveLength(8);
    expect(source).toContain('policies: policy ? [`${policy}@1`] : []');
  });

  test.each([
    'resilience.event.open',
    'resilience.crisis.activate',
    'resilience.decision.record',
    'resilience.communication.publish',
    'resilience.exercise.complete',
    'resilience.lesson.record',
    'resilience.improvement.close',
  ])('enforces policy %s', (policy) => {
    expect(source).toContain(`'${policy}'`);
  });

  test('persists event and decision idempotency keys inside the transaction', () => {
    expect(source).toMatch(/resilience_events[\s\S]*idempotencyKey/);
    expect(source).toMatch(/resilience_decisions[\s\S]*idempotencyKey/);
  });

  test('only applies completion evidence rules to completed exercises', () => {
    expect(source).toContain("const completed = (req.body.status || 'planned') === 'completed'");
    expect(source).toContain("completed ? 'resilience.exercise.complete' : null");
  });
});
