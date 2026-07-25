const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '../routes/business/risk-continuity-links.routes.js'), 'utf8');
const parent = fs.readFileSync(path.join(__dirname, '../routes/business/enterprise-risk.routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/093_risk_continuity_links.sql'), 'utf8');

describe('risk continuity integration', () => {
  test('mounts the integration under the risk module', () => {
    expect(parent).toContain("router.use('/continuity-links', riskContinuityLinksRoutes)");
  });

  test('keeps risk and continuity records as separate sources of truth', () => {
    expect(migration).toContain('risk_id BIGINT NOT NULL REFERENCES enterprise_risks(id)');
    expect(migration).toContain('process_id BIGINT REFERENCES enterprise_business_processes(id)');
    expect(migration).toContain('plan_id BIGINT REFERENCES enterprise_continuity_plans(id)');
  });

  test('validates every referenced record in the same organisation', () => {
    expect(route.match(/organisation_id=\$2/g).length).toBeGreaterThanOrEqual(3);
    expect(route).toContain('integration.plan_process_mismatch');
  });

  test('writes the link transactionally with idempotence', () => {
    expect(route).toContain("type: 'integration.risk_continuity.link'");
    expect(route).toContain('idempotencyKey: key(req)');
  });
});
