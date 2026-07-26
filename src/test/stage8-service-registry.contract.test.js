const { normalizeService, validateRegistry } = require('../operations/serviceRegistry');

describe('stage 8A service registry', () => {
  const service = { id: 'api', name: 'API MADSuite', criticality: 'critical', owners: { business: 'product', technical: 'backend', operational: 'operations' }, dependencies: ['postgres'] };
  test('normalizes a complete service', () => expect(normalizeService(service)).toEqual(expect.objectContaining({ contract: 'service-registry@1', id: 'api' })));
  test('requires all owners', () => expect(() => normalizeService({ ...service, owners: { business: 'product' } })).toThrow('service.owner_technical_required'));
  test('rejects duplicate services', () => expect(() => validateRegistry([service, service])).toThrow('service.duplicate'));
});
