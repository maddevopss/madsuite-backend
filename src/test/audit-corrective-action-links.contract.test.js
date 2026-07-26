const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '../routes/business/audit-corrective-action-links.routes.js'), 'utf8');
const auditRoute = fs.readFileSync(path.join(__dirname, '../routes/business/internal-audit.routes.js'), 'utf8');

describe('audit corrective action links contract', () => {
  test('exposes links without transferring ownership to audit', () => {
    expect(auditRoute).toContain("router.use('/corrective-action-links', auditCorrectiveActionLinksRoutes)");
    expect(route).toContain('performance_improvement_plans');
    expect(route).toContain('cybersecurity_vulnerabilities');
    expect(route).toContain('privacy_retention_actions');
  });

  test('validates finding and target under organisation-scoped locks', () => {
    expect(route.match(/organisation_id=\$2 FOR UPDATE/g)).toHaveLength(2);
    expect(route).toContain('integration.audit_target_not_found');
  });

  test('creates the reference transactionally and idempotently', () => {
    expect(route).toContain("type: 'integration.audit_action_link.create'");
    expect(route).toContain('idempotencyKey');
    expect(route).not.toMatch(/db\.pool\.query\([^)]*(?:INSERT|UPDATE|DELETE)/s);
  });
});
