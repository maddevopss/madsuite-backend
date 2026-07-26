const { createAiAuditRecord } = require('../ai/verifiableAiAudit');

describe('stage 9E AI audit', () => {
  test('redacts secrets and preserves correlation', () => {
    const record = createAiAuditRecord({ requestId: 'req-1', useCaseId: 'billing-review', engineVersion: '1.0.0', organisationId: 1, requestedBy: 7, authorizedContext: { token: 'secret', invoiceId: 9 }, result: { suggestion: 'review' }, humanDecision: { accepted: true } });
    expect(record.authorizedContext.token).toBe('[REDACTED]');
    expect(record.correlationId).toBe('req-1');
  });
});
