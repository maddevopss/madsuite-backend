'use strict';

const { createDataRightsRequest, decideDataRightsRequest } = require('../governance/dataRightsRequests');

describe('data rights requests', () => {
  test('requires verified identity', () => expect(() => createDataRightsRequest({ id: 'r1', type: 'access', subjectId: 'u1', organisationId: 'o1', identityVerified: false, scope: ['clients'], requestedAt: '2026-01-01' })).toThrow(/verified/));
  test('makes refusals motivated and reviewable', () => {
    const request = createDataRightsRequest({ id: 'r1', type: 'deletion', subjectId: 'u1', organisationId: 'o1', identityVerified: true, scope: ['clients'], requestedAt: '2026-01-01' });
    const decision = decideDataRightsRequest(request, { decision: 'refused', reason: 'legal hold', decidedBy: 'privacy-officer', decidedAt: '2026-01-02' });
    expect(decision).toEqual(expect.objectContaining({ reviewable: true, reason: 'legal hold' }));
  });
});
