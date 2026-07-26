const fs = require('fs');
const path = require('path');

const route = fs.readFileSync(path.join(__dirname, '../routes/business/facilities-management.routes.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/098_facilities_maintenance_links.sql'), 'utf8');

describe('facilities maintenance integration contract', () => {
  test('exposes transactional maintenance links', () => {
    expect(route).toContain("router.get('/maintenance-links'");
    expect(route).toContain("router.post('/maintenance-links'");
    expect(route).toContain("'facilities.maintenance_link.create'");
    expect(route).toContain('FROM facilities_assets WHERE id=$1 AND organisation_id=$2 FOR UPDATE');
    expect(route).toContain('FROM asset_records WHERE id=$1 AND organisation_id=$2 FOR UPDATE');
  });

  test('keeps source modules authoritative', () => {
    expect(migration).toContain('facilities_asset_id BIGINT NOT NULL REFERENCES facilities_assets(id)');
    expect(migration).toContain('maintenance_asset_id BIGINT NOT NULL REFERENCES asset_records(id)');
    expect(migration).not.toMatch(/asset_code|name TEXT|status TEXT/);
  });

  test('enforces tenant-scoped idempotency', () => {
    expect(migration).toContain('UNIQUE (organisation_id, idempotency_key)');
  });
});
