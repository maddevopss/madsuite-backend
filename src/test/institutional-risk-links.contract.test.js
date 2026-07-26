const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '../routes/business/institutional-risk-links.routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/094_risk_security_privacy_links.sql'), 'utf8');

describe('institutional risk links contract', () => {
  test('supports cyber and privacy targets without duplicating source data', () => {
    expect(migration).toContain("'cybersecurity_vulnerability'");
    expect(migration).toContain("'cybersecurity_incident'");
    expect(migration).toContain("'privacy_incident'");
    expect(route).toContain('institutional_risk_links');
  });

  test('validates every reference in the same organisation', () => {
    expect(route.match(/organisation_id=\$2 FOR UPDATE/g)).toHaveLength(2);
    expect(route).toContain('integration.target_not_found');
  });

  test('creates links through the transaction engine', () => {
    expect(route).toContain("type: 'integration.risk_link.create'");
    expect(route).toContain('executeTransaction');
    expect(route).not.toMatch(/db\.pool\.query\([^)]*(?:INSERT|UPDATE|DELETE)/s);
  });
});
