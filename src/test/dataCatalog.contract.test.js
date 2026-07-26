'use strict';

const { validateDataAsset, buildDataCatalog } = require('../governance/dataCatalog');

const asset = {
  id: 'invoices', name: 'Factures', owner: 'finance', purpose: 'billing', source: 'postgres',
  consumers: ['reports'], schemaVersion: '1.0.0', organisationScope: 'tenant', environment: 'production'
};

describe('data catalog governance', () => {
  test('accepts a complete governed asset', () => expect(validateDataAsset(asset).id).toBe('invoices'));
  test('rejects orphaned assets', () => expect(() => validateDataAsset({ id: 'x' })).toThrow(/missing data asset field/));
  test('rejects duplicate identifiers', () => expect(() => buildDataCatalog([asset, asset])).toThrow(/duplicate/));
});
