const {
  contractLifecycle,
  applyContractLifecycle,
  deprecationHeaders,
} = require('../utils/contractLifecycle');

describe('contract lifecycle', () => {
  test('keeps an active contract explicit and stable', () => {
    expect(contractLifecycle('integration-list@1')).toEqual({
      contract: 'integration-list@1',
      deprecated: false,
      sunset: null,
      replacedBy: null,
    });
  });

  test('requires deprecation before sunset or replacement', () => {
    expect(() => contractLifecycle('integration-list@1', {
      replacedBy: 'integration-list@2',
    })).toThrow('contract.deprecation_required');
  });

  test('publishes successor metadata and HTTP headers', () => {
    const lifecycle = contractLifecycle('integration-list@1', {
      deprecated: true,
      sunset: '2027-01-01T00:00:00.000Z',
      replacedBy: 'integration-list@2',
    });
    expect(applyContractLifecycle({ limit: 25 }, lifecycle.contract, lifecycle)).toEqual(expect.objectContaining({
      limit: 25,
      deprecated: true,
      replacedBy: 'integration-list@2',
    }));
    expect(deprecationHeaders(lifecycle)).toEqual(expect.objectContaining({
      Deprecation: 'true',
      Sunset: '2027-01-01T00:00:00.000Z',
    }));
  });

  test('rejects malformed and self-replacing contracts', () => {
    expect(() => contractLifecycle('bad contract')).toThrow('contract.name_invalid');
    expect(() => contractLifecycle('transition@1', {
      deprecated: true,
      replacedBy: 'transition@1',
    })).toThrow('contract.replacement_same');
  });
});
