const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../routes/business/facilities-management.routes.js'), 'utf8');

describe('facilities asset decommission', () => {
  test('exposes a dedicated asset decommission route', () => {
    expect(source).toContain("router.post('/assets/:id/decommission'");
  });

  test('applies the decommission policy', () => {
    expect(source).toContain("'facilities.asset.decommission'");
  });

  test('locks the asset before changing its status', () => {
    expect(source).toContain('SELECT id,status FROM facilities_assets WHERE id=$1 AND organisation_id=$2 FOR UPDATE');
  });

  test('keeps decommission separate from disposal', () => {
    expect(source).toContain("status='decommissioned'");
    expect(source).toContain("router.post('/disposals'");
  });
});
