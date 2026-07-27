const fs = require('fs');
const path = require('path');
const {
  calculateAvailableQuantity,
  validateReservation,
  calculateCountVariance,
  validateCycleCountApproval,
  validateLotDisposition,
  validateInventoryClosure,
} = require('../services/business/inventory-complete.service');

describe('inventory complete block contract', () => {
  test('calculates truly available quantity after reservations', () => {
    expect(calculateAvailableQuantity({ quantityOnHand: 20, reservedQuantity: 7 })).toBe(13);
  });

  test('blocks reservations above available stock or without evidence', () => {
    expect(validateReservation({ quantity: 14, availableQuantity: 13, evidence: [{}] }).code).toBe('inventory.reservation.insufficient_available');
    expect(validateReservation({ quantity: 3, availableQuantity: 13, evidence: [] }).code).toBe('inventory.reservation.evidence_required');
    expect(validateReservation({ quantity: 3, availableQuantity: 13, evidence: [{}] }).allowed).toBe(true);
  });

  test('calculates physical count variances in quantity and value', () => {
    expect(calculateCountVariance({ expectedQuantity: 10, countedQuantity: 8, unitCost: 12.5 })).toEqual({ varianceQuantity: -2, varianceValue: -25 });
  });

  test('requires completed count, variance reason and evidence before approval', () => {
    const items = [{ expectedQuantity: 10, countedQuantity: 8 }];
    expect(validateCycleCountApproval({ status: 'submitted', items, evidence: [{}] }).code).toBe('inventory.count.variance_reason_required');
    expect(validateCycleCountApproval({ status: 'submitted', items, evidence: [{}], decisionReason: 'Bris confirmé' }).allowed).toBe(true);
  });

  test('requires reason and evidence for lot quarantine or disposal', () => {
    expect(validateLotDisposition({ status: 'disposed', quantity: 2, evidence: [] }).code).toBe('inventory.lot.reason_required');
    expect(validateLotDisposition({ status: 'disposed', quantity: 2, reason: 'Produit expiré', evidence: [{}] }).allowed).toBe(true);
  });

  test('blocks closure while counts, negative balances or expired available lots remain', () => {
    expect(validateInventoryClosure({ unresolvedCounts: 1, evidence: [{}] }).code).toBe('inventory.closure.counts_unresolved');
    expect(validateInventoryClosure({ negativeBalances: 1, evidence: [{}] }).code).toBe('inventory.closure.negative_balances');
    expect(validateInventoryClosure({ expiredLotsAvailable: 1, evidence: [{}] }).code).toBe('inventory.closure.expired_lots_available');
    expect(validateInventoryClosure({ evidence: [{}] }).allowed).toBe(true);
  });

  test('migration, route mount and RLS policies remain part of the contract', () => {
    const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/20260727222000_inventory_complete_block.sql'), 'utf8');
    const routes = fs.readFileSync(path.join(__dirname, '../routes/business/inventory.routes.js'), 'utf8');
    expect(migration).toContain('inventory_reservations');
    expect(migration).toContain('inventory_cycle_counts');
    expect(migration).toContain('inventory_lots');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(routes).toContain("require('./inventory-complete.routes')");
    expect(routes).toContain('inventoryCompleteRoutes');
  });
});