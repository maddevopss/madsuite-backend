'use strict';
const { validateDataSovereignty } = require('../core/scaling/dataSovereignty');
describe('data sovereignty', () => {
  it('accepts documented regions and restore plans', () => {
    expect(validateDataSovereignty({ dataset:'tenant-data', primaryRegion:'ca-central', backupRegions:['ca-east'], dependencies:['postgres'], restorePlan:'restore-v1' }).documented).toBe(true);
  });
  it('refuses unproven residency claims', () => {
    expect(() => validateDataSovereignty({ dataset:'tenant-data', primaryRegion:'ca-central', backupRegions:[], dependencies:[], restorePlan:'restore-v1', residencyClaim:'Canada only' })).toThrow('residency_claim_without_evidence');
  });
});
