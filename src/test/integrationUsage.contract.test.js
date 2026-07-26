'use strict';

const { evaluateQuota, buildUsageEntry } = require('../integrations/integrationUsage');

describe('integration quotas and usage', () => {
  test('evaluates limits per organisation and integration', () => {
    expect(evaluateQuota({ organisationId: 'org-a', integrationId: 'calendar', usage: { requests: 11 }, limits: { requests: 10 } }))
      .toEqual(expect.objectContaining({ allowed: false, exceeded: ['requests'] }));
  });

  test('prevents financial double billing', () => {
    expect(() => buildUsageEntry({
      organisationId: 'org-a', integrationId: 'calendar', period: '2026-07', metric: 'requests', quantity: 5,
      financialEntryId: 'ledger-1', billable: true
    })).toThrow('integration_usage.double_billing_forbidden');
  });
});
