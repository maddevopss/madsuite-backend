'use strict';

const { defineAvailabilityTarget, findSinglePointsOfFailure } = require('../resilience/availabilityMap');

describe('stage 13A availability map', () => {
  test('computes an explicit error budget', () => {
    const target = defineAvailabilityTarget({ component: 'api', owner: 'platform', serviceClass: 'essential', targetPercent: 99.9, measurementWindowDays: 30 });
    expect(target.allowedDowntimeMinutes).toBe(43);
  });

  test('detects critical components without redundancy', () => {
    expect(findSinglePointsOfFailure([{ name: 'db', critical: true, redundancy: 1 }, { name: 'cache', critical: false }])).toHaveLength(1);
  });
});
