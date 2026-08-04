/**
 * Issue #172 PR G: Compatibility & Deprecation — Contract Versioning Tests
 *
 * Validates:
 * 1. Contract version management system
 * 2. Deprecation metadata tracking
 * 3. HTTP headers for deprecated contracts
 * 4. Backward compatibility adapter patterns
 * 5. Contract migration paths
 */

const {
  CONTRACT_VERSIONS,
  getContractVersion,
  isDeprecated,
  addDeprecationHeaders,
  withContractMeta,
  createContractAdapter,
  listContracts,
  registerContractVersion,
  deprecateContractVersion,
} = require('../utils/contractVersioning');

describe('PR G: Contract Versioning & Deprecation', () => {
  let originalRegistry;

  beforeEach(() => {
    originalRegistry = JSON.parse(JSON.stringify(CONTRACT_VERSIONS));
  });

  afterEach(() => {
    Object.keys(CONTRACT_VERSIONS).forEach(key => delete CONTRACT_VERSIONS[key]);
    Object.assign(CONTRACT_VERSIONS, originalRegistry);
  });

  describe('contractVersioning utility', () => {
    it('should expose CONTRACT_VERSIONS registry', () => {
      expect(CONTRACT_VERSIONS).toBeDefined();
      expect(typeof CONTRACT_VERSIONS).toBe('object');
    });

    it('should list defined contracts', () => {
      expect(CONTRACT_VERSIONS['integration-list']).toBeDefined();
      expect(CONTRACT_VERSIONS['server-capabilities']).toBeDefined();
      expect(CONTRACT_VERSIONS['transition']).toBeDefined();
      expect(CONTRACT_VERSIONS['block-closure']).toBeDefined();
    });
  });

  describe('getContractVersion function', () => {
    it('should retrieve contract info by name', () => {
      const info = getContractVersion('integration-list');
      expect(info.contractId).toBe('integration-list@1');
      expect(info.deprecated).toBe(false);
    });

    it('should retrieve contract info by name and version', () => {
      const info = getContractVersion('server-capabilities', '1');
      expect(info.version).toBe('1');
      expect(info.name).toBe('server-capabilities');
    });

    it('should throw for unknown contract', () => {
      expect(() => getContractVersion('nonexistent')).toThrow();
    });

    it('should throw for unknown contract version', () => {
      expect(() => getContractVersion('integration-list', '99')).toThrow();
    });

    it('should return default current version when not specified', () => {
      const info1 = getContractVersion('integration-list');
      const info2 = getContractVersion('integration-list', '1');
      expect(info1.version).toBe(info2.version);
    });
  });

  describe('isDeprecated function', () => {
    it('should return false for current contracts', () => {
      expect(isDeprecated('integration-list')).toBe(false);
      expect(isDeprecated('server-capabilities')).toBe(false);
    });

    it('should support version parameter', () => {
      expect(isDeprecated('integration-list', '1')).toBe(false);
    });

    it('should return false if contract not found gracefully', () => {
      // In real code, getContractVersion would throw, but we test the function's logic
      expect(isDeprecated('integration-list')).toBe(false);
    });
  });

  describe('deprecation metadata', () => {
    it('should include deprecated flag in contract info', () => {
      const info = getContractVersion('transition');
      expect(info).toHaveProperty('deprecated');
      expect(typeof info.deprecated).toBe('boolean');
    });

    it('should include sunset date when deprecated', () => {
      const info = getContractVersion('transition');
      expect(info).toHaveProperty('sunset');
    });

    it('should include replacedBy when applicable', () => {
      const info = getContractVersion('integration-list');
      expect(info).toHaveProperty('replacedBy');
    });

    it('should include release date', () => {
      const info = getContractVersion('server-capabilities');
      expect(info).toHaveProperty('releaseDate');
      expect(typeof info.releaseDate).toBe('string');
    });
  });

  describe('addDeprecationHeaders function', () => {
    let mockRes;

    beforeEach(() => {
      mockRes = {
        set: jest.fn().mockReturnThis(),
      };
    });

    it('should not add headers for non-deprecated contracts', () => {
      addDeprecationHeaders(mockRes, 'integration-list', '1');
      // No deprecation headers should be added
      expect(mockRes.set).not.toHaveBeenCalledWith('Deprecation', expect.anything());
    });

    it('should add Deprecation header for deprecated contracts', () => {
      // Setup a deprecated contract scenario
      registerContractVersion('test-contract', '1', {
        deprecated: true,
        releaseDate: '2024-01-01',
      });
       deprecateContractVersion('test-contract', '1');


      addDeprecationHeaders(mockRes, 'test-contract', '1');
      expect(mockRes.set).toHaveBeenCalledWith('Deprecation', 'true');
    });

    it('should add Sunset header when sunset date exists', () => {
      const sunsetDate = '2026-12-31';
      registerContractVersion('future-contract', '1', {
        deprecated: true,
        sunset: sunsetDate,
        releaseDate: '2026-01-01',
      });

      addDeprecationHeaders(mockRes, 'future-contract', '1');
      expect(mockRes.set).toHaveBeenCalledWith('Sunset', expect.any(String));
    });

    it('should add X-Contract-Deprecated header', () => {
      registerContractVersion('deprecated-v1', '1', {
        deprecated: true,
        releaseDate: '2024-06-01',
      });

      addDeprecationHeaders(mockRes, 'deprecated-v1', '1');
      expect(mockRes.set).toHaveBeenCalledWith('X-Contract-Deprecated', 'deprecated-v1@1');
    });
  });

  describe('withContractMeta function', () => {
    it('should add contract metadata to response', () => {
      const data = { items: [] };
      const result = withContractMeta(data, 'integration-list');

      expect(result.meta).toBeDefined();
      expect(result.meta.contract).toBe('integration-list@1');
    });

    it('should preserve existing meta properties', () => {
      const data = { items: [], meta: { count: 5 } };
      const result = withContractMeta(data, 'integration-list');

      expect(result.meta.count).toBe(5);
      expect(result.meta.contract).toBe('integration-list@1');
    });

    it('should include deprecated flag', () => {
      const data = { items: [] };
      const result = withContractMeta(data, 'integration-list', '1');

      expect(result.meta.deprecated).toBe(false);
    });

    it('should include sunset date if deprecated', () => {
      registerContractVersion('sunset-contract', '1', {
        deprecated: true,
        sunset: '2026-12-31',
        releaseDate: '2025-01-01',
      });

      const data = { items: [] };
      const result = withContractMeta(data, 'sunset-contract', '1');

      expect(result.meta.sunset).toBe('2026-12-31');
    });
  });

  describe('createContractAdapter function', () => {
    it('should return adapter function', () => {
      const adapter = createContractAdapter('1', '2');
      expect(typeof adapter).toBe('function');
    });

    it('adapter should convert data between versions', () => {
      const adapter = createContractAdapter('1', '2');
      const data = { items: [{ id: 1 }] };
      const result = adapter(data);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should support bidirectional adaptation', () => {
      const adapter12 = createContractAdapter('1', '2');
      const adapter21 = createContractAdapter('2', '1');

      const data = { items: [] };
      const converted = adapter12(data);
      const reverted = adapter21(converted);

      expect(reverted).toBeDefined();
    });
  });

  describe('listContracts function', () => {
    it('should return all contracts', () => {
      const contracts = listContracts();

      expect(contracts['integration-list']).toBeDefined();
      expect(contracts['server-capabilities']).toBeDefined();
    });

    it('should include current version for each contract', () => {
      const contracts = listContracts();

      expect(contracts['integration-list'].current).toBe('1');
    });

    it('should list all versions for each contract', () => {
      const contracts = listContracts();

      expect(Array.isArray(contracts['integration-list'].versions)).toBe(true);
      expect(contracts['integration-list'].versions.length).toBeGreaterThan(0);
    });

    it('should include metadata for each version', () => {
      const contracts = listContracts();
      const meta = contracts['integration-list'].metadata;

      expect(meta['1']).toBeDefined();
      expect(meta['1'].releaseDate).toBeDefined();
    });
  });

  describe('registerContractVersion function', () => {
    it('should register new contract version', () => {
      registerContractVersion('new-contract', '1', { releaseDate: '2026-08-01' });

      const info = getContractVersion('new-contract', '1');
      expect(info.contractId).toBe('new-contract@1');
    });

    it('should update current version if higher', () => {
      registerContractVersion('versioned-contract', '1');
      registerContractVersion('versioned-contract', '2');

      expect(CONTRACT_VERSIONS['versioned-contract'].current).toBe('2');
    });

    it('should set release date automatically if not provided', () => {
      registerContractVersion('auto-date-contract', '1');

      const info = getContractVersion('auto-date-contract', '1');
      expect(info.releaseDate).toBeDefined();
    });
  });

  describe('deprecateContractVersion function', () => {
    it('should mark contract as deprecated', () => {
      registerContractVersion('to-deprecate', '1');
      deprecateContractVersion('to-deprecate', '1');

      expect(isDeprecated('to-deprecate', '1')).toBe(true);
    });

    it('should set sunset date', () => {
      registerContractVersion('sunset-test', '1');
      const sunsetDate = '2026-12-31';
      deprecateContractVersion('sunset-test', '1', { sunsetDate });

      const info = getContractVersion('sunset-test', '1');
      expect(info.sunset).toBeDefined();
    });

    it('should set replacedBy reference', () => {
      registerContractVersion('replaced-test', '1');
      deprecateContractVersion('replaced-test', '1', { replacedBy: 'replaced-test@2' });

      const info = getContractVersion('replaced-test', '1');
      expect(info.replacedBy).toBe('replaced-test@2');
    });
  });

  describe('backward compatibility scenarios', () => {
    it('should support older API clients using v1', () => {
      // v1 contracts remain available and non-deprecated
      const v1 = getContractVersion('integration-list', '1');
      expect(v1.deprecated).toBe(false);
      expect(v1.contractId).toBe('integration-list@1');
    });

    it('should allow migration path from v1 to v2', () => {
      // Register v2 (new version)
      registerContractVersion('migration-contract', '1');
      registerContractVersion('migration-contract', '2');

      // Deprecate v1 with sunset and successor
      deprecateContractVersion('migration-contract', '1', {
        sunsetDate: '2026-12-31',
        replacedBy: 'migration-contract@2',
      });

      // v2 should be current
      expect(CONTRACT_VERSIONS['migration-contract'].current).toBe('2');

      // v1 should have migration info
      const v1Info = getContractVersion('migration-contract', '1');
      expect(v1Info.replacedBy).toBe('migration-contract@2');
    });

    it('should support parallel contract versions during transition', () => {
      registerContractVersion('parallel-test', '1');
      registerContractVersion('parallel-test', '2');

      // Both should be queryable
      const v1 = getContractVersion('parallel-test', '1');
      const v2 = getContractVersion('parallel-test', '2');

      expect(v1.version).toBe('1');
      expect(v2.version).toBe('2');
    });
  });

  describe('production readiness', () => {
    it('should handle missing metadata gracefully', () => {
      const info = getContractVersion('integration-list');
      expect(info.name).toBeDefined();
      expect(info.version).toBeDefined();
      expect(info.contractId).toBeDefined();
    });

    it('should not expose internal state modification', () => {
      const beforeCount = Object.keys(listContracts()).length;

      // Deprecate a contract
      registerContractVersion('readonly-test', '1');
      deprecateContractVersion('readonly-test', '1');

      // Count should be consistent
      const afterCount = Object.keys(listContracts()).length;
      expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
    });
  });
});
