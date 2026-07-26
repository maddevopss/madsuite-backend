'use strict';

const { recordLineage, reconstructLineage } = require('../governance/dataLineage');

describe('data lineage', () => {
  test('reconstructs only the requested organisation path', () => {
    const records = [
      recordLineage({ assetId: 'invoice', source: 'db', destinations: ['report'], organisationId: 'org-a', occurredAt: '2026-01-01T00:00:00Z' }),
      recordLineage({ assetId: 'invoice', source: 'db', destinations: ['export'], organisationId: 'org-b', occurredAt: '2026-01-01T00:00:00Z' })
    ];
    expect(reconstructLineage(records, 'invoice', 'org-a')).toHaveLength(1);
  });
});
