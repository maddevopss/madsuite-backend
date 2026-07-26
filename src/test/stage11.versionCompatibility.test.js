'use strict';
const { validateCompatibilityWindow } = require('../core/scaling/versionCompatibility');
describe('version compatibility', () => {
  it('accepts a supported current version', () => {
    expect(validateCompatibilityWindow({ name:'invoice-api', currentVersion:'v2', supportedVersions:['v1','v2'], deprecationDate:'2027-01-01' }).valid).toBe(true);
  });
  it('requires migration plans for breaking changes', () => {
    expect(() => validateCompatibilityWindow({ name:'invoice-api', currentVersion:'v2', supportedVersions:['v2'], deprecationDate:'2027-01-01', breakingChange:true })).toThrow('breaking_change_requires_migration_plan');
  });
});
