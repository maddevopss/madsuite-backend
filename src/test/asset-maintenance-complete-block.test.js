const fs = require('fs');
const path = require('path');
const { validateClosure } = require('../services/business/asset-maintenance-closure.service');

const ROOT = path.join(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('Bloc Maintenance complet', () => {
  test('refuse une fermeture sans vérification et sans preuve', () => {
    expect(validateClosure({ workOrder: { status: 'completed' } })).toEqual({ allowed: false, code: 'assets.work_order_not_verified' });
  });

  test('refuse la remise en service d un bien non sécuritaire', () => {
    const decision = validateClosure({
      workOrder: { status: 'verified', diagnosis: 'Usure', resolution: 'Pièce remplacée', evidence: ['photo'], labour_cost: 0, parts_cost: 0 },
      returnToServiceCheck: { safe_to_operate: false, evidence: ['inspection'] },
    });
    expect(decision.code).toBe('assets.asset_not_safe_to_operate');
  });

  test('autorise une fermeture entièrement prouvée', () => {
    const decision = validateClosure({
      workOrder: { status: 'verified', diagnosis: 'Roulement usé', resolution: 'Roulement remplacé et testé', evidence: ['photo', 'rapport'], labour_cost: 120, parts_cost: 85 },
      returnToServiceCheck: { safe_to_operate: true, evidence: ['inspection signée'] },
      labour: [{ minutes_worked: 90 }],
      parts: [{ description: 'Roulement', quantity: 1 }],
    });
    expect(decision).toEqual({ allowed: true, code: 'assets.closure_allowed' });
  });

  test('le modèle couvre les demandes, coûts, pièces et remise en service', () => {
    const migration = read('db/migrations/20260727220000_asset_maintenance_complete_block.sql');
    for (const table of [
      'asset_maintenance_requests',
      'asset_work_order_labour',
      'asset_work_order_parts',
      'asset_return_to_service_checks',
      'asset_work_order_status_events',
    ]) expect(migration).toContain(table);
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('organisation_isolation');
  });

  test('l API expose le parcours opérationnel complet', () => {
    const routes = read('src/routes/business/asset-maintenance.routes.js');
    for (const route of [
      '/records', '/plans', '/requests', '/work-orders', '/work-orders/:id/labour',
      '/work-orders/:id/parts', '/work-orders/:id/return-to-service', '/work-orders/:id/close', '/alerts',
    ]) expect(routes).toContain(route);
    expect(routes).toContain('organisation_id=$1');
  });
});
