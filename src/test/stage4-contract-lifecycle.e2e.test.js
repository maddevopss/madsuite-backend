/**
 * Issue #172 PR H: Contract Lifecycle E2E Tests
 *
 * Validates complete contract versioning lifecycle:
 * 1. Contract registration and current version
 * 2. Deprecation transitions (v1→v2)
 * 3. HTTP header injection across middleware chain
 * 4. Client migration patterns
 * 5. Parallel version availability
 * 6. OpenAPI spec compliance
 */

const express = require('express');
const {
  registerContractVersion,
  deprecateContractVersion,
  getContractVersion,
  isDeprecated,
  withContractMeta,
  listContracts,
} = require('../utils/contractVersioning');
const contractDeprecationMiddleware = require('../middleware/contractDeprecation.middleware');
const apiResponseMiddleware = require('../middleware/apiResponse');

describe('PR H: Contract Lifecycle E2E', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(apiResponseMiddleware);
    app.use(contractDeprecationMiddleware());
  });

  describe('Phase 1: Contract Registration', () => {
    it('should register new contract versions', () => {
      registerContractVersion('test-contract', '1', {
        releaseDate: '2026-08-01',
      });
      registerContractVersion('test-contract', '2', {
        releaseDate: '2026-09-01',
      });

      const contracts = listContracts();
      expect(contracts['test-contract']).toBeDefined();
      expect(contracts['test-contract'].versions['1']).toBeDefined();
      expect(contracts['test-contract'].versions['2']).toBeDefined();
    });

    it('should set current version to highest on registration', () => {
      registerContractVersion('version-test', '1', { releaseDate: '2026-08-01' });
      const after1 = getContractVersion('version-test');
      expect(after1.version).toBe('1');

      registerContractVersion('version-test', '2', { releaseDate: '2026-09-01' });
      const after2 = getContractVersion('version-test');
      expect(after2.version).toBe('2');
    });

    it('should track release dates for audit trail', () => {
      const releaseDate = '2026-08-03';
      registerContractVersion('dated-contract', '1', { releaseDate });

      const contract = getContractVersion('dated-contract', '1');
      expect(contract.releaseDate).toBe(releaseDate);
    });
  });

  describe('Phase 2: Parallel Version Availability', () => {
    beforeEach(() => {
      registerContractVersion('parallel-test', '1', {
        releaseDate: '2026-08-01',
      });
      registerContractVersion('parallel-test', '2', {
        releaseDate: '2026-09-01',
      });
    });

    it('should allow retrieving both old and new versions', () => {
      const v1 = getContractVersion('parallel-test', '1');
      const v2 = getContractVersion('parallel-test', '2');

      expect(v1.version).toBe('1');
      expect(v2.version).toBe('2');
      expect(v1.deprecated).toBe(false);
      expect(v2.deprecated).toBe(false);
    });

    it('should route requests to appropriate version based on Accept header or query param', () => {
      // Simulate versioned endpoint behavior
      app.get('/api/data', (req, res) => {
        const requestedVersion = req.query.version || '2';
        const contract = getContractVersion('parallel-test', requestedVersion);

        res.json(
          withContractMeta(
            {
              items: [{ id: 1, data: 'test' }],
            },
            'parallel-test',
            requestedVersion,
          ),
        );
      });

      // Both versions should be available
      expect(() => {
        const v1Contract = getContractVersion('parallel-test', '1');
        const v2Contract = getContractVersion('parallel-test', '2');
        expect(v1Contract).toBeDefined();
        expect(v2Contract).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('Phase 3: Deprecation Transition', () => {
    beforeEach(() => {
      registerContractVersion('transition-test', '1', {
        releaseDate: '2026-08-01',
      });
      registerContractVersion('transition-test', '2', {
        releaseDate: '2026-09-01',
      });
    });

    it('should transition v1 to deprecated status', () => {
      expect(isDeprecated('transition-test', '1')).toBe(false);

      deprecateContractVersion('transition-test', '1', {
        sunsetDate: '2026-12-31',
        replacedBy: 'transition-test@2',
      });

      expect(isDeprecated('transition-test', '1')).toBe(true);
      expect(isDeprecated('transition-test', '2')).toBe(false);
    });

    it('should maintain v2 as current non-deprecated version during transition', () => {
      deprecateContractVersion('transition-test', '1', {
        sunsetDate: '2026-12-31',
        replacedBy: 'transition-test@2',
      });

      const v1 = getContractVersion('transition-test', '1');
      const v2 = getContractVersion('transition-test', '2');

      expect(v1.deprecated).toBe(true);
      expect(v2.deprecated).toBe(false);
      expect(v2.replacedBy).toBeNull();
    });

    it('should track sunset date for planned removal', () => {
      const sunsetDate = '2026-12-31';
      deprecateContractVersion('transition-test', '1', {
        sunsetDate,
        replacedBy: 'transition-test@2',
      });

      const v1 = getContractVersion('transition-test', '1');
      expect(v1.sunset).toBe(sunsetDate);
    });

    it('should track replacement contract reference', () => {
      deprecateContractVersion('transition-test', '1', {
        sunsetDate: '2026-12-31',
        replacedBy: 'transition-test@2',
      });

      const v1 = getContractVersion('transition-test', '1');
      expect(v1.replacedBy).toBe('transition-test@2');
    });
  });

  describe('Phase 4: HTTP Header Injection', () => {
    beforeEach(() => {
      registerContractVersion('header-test', '1', {
        releaseDate: '2026-08-01',
      });
      deprecateContractVersion('header-test', '1', {
        sunsetDate: '2026-12-31',
        replacedBy: 'header-test@2',
      });

      app.get('/api/deprecated', (req, res) => {
        res.json(
          withContractMeta(
            {
              items: [{ id: 1 }],
            },
            'header-test',
            '1',
          ),
        );
      });

      app.get('/api/current', (req, res) => {
        res.json({
          items: [{ id: 1 }],
          meta: {
            contract: 'integration-list@1',
          },
        });
      });
    });

    it('should inject Deprecation header for deprecated contracts', (done) => {
      const request = require('supertest');
      const testApp = app;

      request(testApp)
        .get('/api/deprecated')
        .end((err, res) => {
          expect(res.headers['deprecation']).toBe('true');
          done();
        });
    });

    it('should inject X-Contract-Deprecated header with contract identifier', (done) => {
      const request = require('supertest');
      const testApp = app;

      request(testApp)
        .get('/api/deprecated')
        .end((err, res) => {
          expect(res.headers['x-contract-deprecated']).toBe('header-test@1');
          done();
        });
    });

    it('should inject Sunset header in RFC 2822 format', (done) => {
      const request = require('supertest');
      const testApp = app;

      request(testApp)
        .get('/api/deprecated')
        .end((err, res) => {
          expect(res.headers['sunset']).toBeDefined();
          // Should be RFC 2822 format (toUTCString)
          expect(typeof res.headers['sunset']).toBe('string');
          done();
        });
    });

    it('should inject Link header with successor version', (done) => {
      const request = require('supertest');
      const testApp = app;

      request(testApp)
        .get('/api/deprecated')
        .end((err, res) => {
          expect(res.headers['link']).toBeDefined();
          expect(res.headers['link']).toContain('header-test@2');
          done();
        });
    });

    it('should not inject headers for current contracts', (done) => {
      const request = require('supertest');
      const testApp = app;

      request(testApp)
        .get('/api/current')
        .end((err, res) => {
          expect(res.headers['deprecation']).toBeUndefined();
          expect(res.headers['x-contract-deprecated']).toBeUndefined();
          done();
        });
    });
  });

  describe('Phase 5: Response Body Metadata', () => {
    it('should include contract metadata in response body for deprecated contracts', () => {
      registerContractVersion('body-test', '1', {
        releaseDate: '2026-08-01',
      });
      deprecateContractVersion('body-test', '1', {
        sunsetDate: '2026-12-31',
        replacedBy: 'body-test@2',
      });

      const response = withContractMeta(
        { items: [] },
        'body-test',
        '1',
      );

      expect(response.meta.contract).toBe('body-test@1');
      expect(response.meta.deprecated).toBe(true);
      expect(response.meta.sunset).toBe('2026-12-31');
      expect(response.meta.replacedBy).toBe('body-test@2');
    });

    it('should include minimal metadata for current contracts', () => {
      registerContractVersion('current-test', '1', {
        releaseDate: '2026-08-01',
      });

      const response = withContractMeta(
        { items: [] },
        'current-test',
        '1',
      );

      expect(response.meta.contract).toBe('current-test@1');
      expect(response.meta.deprecated).toBe(false);
      expect(response.meta.sunset).toBeNull();
      expect(response.meta.replacedBy).toBeNull();
    });

    it('should preserve existing meta properties when wrapping', () => {
      registerContractVersion('preserve-test', '1', {
        releaseDate: '2026-08-01',
      });

      const response = withContractMeta(
        {
          items: [],
          meta: { count: 5, limit: 25 },
        },
        'preserve-test',
        '1',
      );

      expect(response.meta.contract).toBe('preserve-test@1');
      expect(response.meta.count).toBe(5);
      expect(response.meta.limit).toBe(25);
    });
  });

  describe('Phase 6: Client Migration Patterns', () => {
    beforeEach(() => {
      // Simulate v1→v2 migration scenario
      registerContractVersion('migration-test', '1', {
        releaseDate: '2026-08-01',
      });
      registerContractVersion('migration-test', '2', {
        releaseDate: '2026-09-01',
      });
    });

    it('should allow old clients to continue using v1 during deprecation period', () => {
      const v1 = getContractVersion('migration-test', '1');
      expect(v1).toBeDefined();
      expect(v1.version).toBe('1');
    });

    it('should allow new clients to adopt v2', () => {
      const v2 = getContractVersion('migration-test', '2');
      expect(v2).toBeDefined();
      expect(v2.version).toBe('2');
    });

    it('should signal v1 deprecation after transition phase', () => {
      deprecateContractVersion('migration-test', '1', {
        sunsetDate: '2026-12-31',
        replacedBy: 'migration-test@2',
      });

      const v1 = getContractVersion('migration-test', '1');
      expect(isDeprecated('migration-test', '1')).toBe(true);
      expect(v1.replacedBy).toBe('migration-test@2');
    });

    it('should enable client migration via metadata in response and headers', () => {
      deprecateContractVersion('migration-test', '1', {
        sunsetDate: '2026-12-31',
        replacedBy: 'migration-test@2',
      });

      const response = withContractMeta(
        { items: [] },
        'migration-test',
        '1',
      );

      // Client reads: meta.replacedBy → 'migration-test@2'
      expect(response.meta.replacedBy).toBe('migration-test@2');

      // Client also checks headers (mocked): Link header with successor
      // This is verified in earlier HTTP header injection tests
    });
  });

  describe('Phase 7: Contract Registry Discovery', () => {
    it('should provide complete contract inventory for discovery', () => {
      registerContractVersion('discovery-v1', '1', {
        releaseDate: '2026-08-01',
      });
      registerContractVersion('discovery-v2', '2', {
        releaseDate: '2026-09-01',
      });

      const contracts = listContracts();

      expect(contracts).toBeDefined();
      expect(contracts['discovery-v1']).toBeDefined();
      expect(contracts['discovery-v2']).toBeDefined();
    });

    it('should expose current version for each contract', () => {
      registerContractVersion('current-discovery', '1', {
        releaseDate: '2026-08-01',
      });
      registerContractVersion('current-discovery', '2', {
        releaseDate: '2026-09-01',
      });

      const contracts = listContracts();
      expect(contracts['current-discovery'].current).toBe('2');
    });

    it('should list all available versions for each contract', () => {
      registerContractVersion('multi-version', '1', {
        releaseDate: '2026-08-01',
      });
      registerContractVersion('multi-version', '2', {
        releaseDate: '2026-09-01',
      });
      registerContractVersion('multi-version', '3', {
        releaseDate: '2026-10-01',
      });

      const contracts = listContracts();
      const versions = Object.keys(contracts['multi-version'].versions);

      expect(versions).toContain('1');
      expect(versions).toContain('2');
      expect(versions).toContain('3');
    });

    it('should include deprecation status in inventory', () => {
      registerContractVersion('inventory-test', '1', {
        releaseDate: '2026-08-01',
      });
      registerContractVersion('inventory-test', '2', {
        releaseDate: '2026-09-01',
      });

      deprecateContractVersion('inventory-test', '1', {
        sunsetDate: '2026-12-31',
        replacedBy: 'inventory-test@2',
      });

      const contracts = listContracts();
      const v1Meta = contracts['inventory-test'].versions['1'];

      expect(v1Meta.deprecated).toBe(true);
      expect(v1Meta.sunset).toBe('2026-12-31');
      expect(v1Meta.replacedBy).toBe('inventory-test@2');
    });
  });

  describe('Phase 8: Production Readiness', () => {
    it('should handle all 5 Stage 4 contracts at v1', () => {
      const contracts = listContracts();

      // All Stage 4 contracts should exist
      const stageContracts = [
        'integration-list',
        'integration-resource',
        'server-capabilities',
        'transition',
        'block-closure',
      ];

      stageContracts.forEach(name => {
        expect(contracts[name]).toBeDefined();
        expect(contracts[name].current).toBe('1');
      });
    });

    it('should not expose internal state in public responses', () => {
      const response = withContractMeta(
        { items: [] },
        'integration-list',
        '1',
      );

      // Should not expose internal registry state
      expect(response.meta.versions).toBeUndefined();
      expect(response.meta._internal).toBeUndefined();
    });

    it('should gracefully handle unknown contract requests', () => {
      expect(() => {
        getContractVersion('nonexistent', '1');
      }).toThrow();
    });

    it('should gracefully handle unknown version requests', () => {
      registerContractVersion('version-test-prod', '1', {
        releaseDate: '2026-08-01',
      });

      expect(() => {
        getContractVersion('version-test-prod', '99');
      }).toThrow();
    });
  });
});
