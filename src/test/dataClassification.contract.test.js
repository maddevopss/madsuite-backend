'use strict';

const { classifyData, authorizeClassifiedAccess } = require('../governance/dataClassification');

describe('data classification', () => {
  test('refuses unclassified data', () => expect(() => classifyData({ assetId: 'a', owner: 'o', justification: 'j' })).toThrow());
  test('requires privileged access for highly sensitive data', () => {
    const c = classifyData({ assetId: 'payroll', level: 'highly_sensitive', owner: 'hr', justification: 'pay processing' });
    expect(authorizeClassifiedAccess(c, 'read')).toBe(false);
    expect(authorizeClassifiedAccess(c, 'explicit_privileged_read')).toBe(true);
  });
});
