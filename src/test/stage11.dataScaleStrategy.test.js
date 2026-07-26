'use strict';
const { validateDataScalePlan } = require('../core/scaling/dataScaleStrategy');
describe('data scale strategy', () => {
  it('accepts progressive migrations', () => {
    expect(validateDataScalePlan({ table:'events', indexStrategy:'tenant-time', archivePolicy:'cold-after-1y', retentionPolicy:'7y', migrationMode:'expand-contract', partitioning:true, partitionKey:'organisation_id' }).approved).toBe(true);
  });
  it('rejects unsafe migrations', () => {
    expect(() => validateDataScalePlan({ table:'events', indexStrategy:'x', archivePolicy:'x', retentionPolicy:'x', migrationMode:'stop-the-world' })).toThrow('unsafe_migration_mode');
  });
});
