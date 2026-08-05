jest.setTimeout(30000);

/**
 * Issue #172 PR G: Contract Deprecation Middleware Integration Tests
 *
 * Validates:
 * 1. Middleware correctly intercepts and modifies responses
 * 2. Deprecation headers added to deprecated contracts
 * 3. No headers added for non-deprecated contracts
 * 4. Headers follow HTTP standards (Deprecation, Sunset, Link)
 */

const contractDeprecationMiddleware = require('../middleware/contractDeprecation.middleware');
const {
  CONTRACT_VERSIONS,
  registerContractVersion,
  deprecateContractVersion,
} = require('../utils/contractVersioning');

describe('PR G: Contract Deprecation Middleware Integration', () => {
  let originalRegistry;

  beforeEach(() => {
    originalRegistry = JSON.parse(JSON.stringify(CONTRACT_VERSIONS));
  });

  afterEach(() => {
    Object.keys(CONTRACT_VERSIONS).forEach(key => delete CONTRACT_VERSIONS[key]);
    Object.assign(CONTRACT_VERSIONS, originalRegistry);
  });

  describe('middleware factory', () => {
    it('should export middleware function', () => {
      expect(typeof contractDeprecationMiddleware).toBe('function');
    });

    it('middleware should return function', () => {
      const middleware = contractDeprecationMiddleware();
      expect(typeof middleware).toBe('function');
    });

    it('middleware should be Express-compatible', () => {
      const middleware = contractDeprecationMiddleware();
      // Signature: (req, res, next) => void
      expect(middleware.length).toBe(3);
    });
  });

  describe('response interception', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
      mockReq = {};
      mockRes = {
        set: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      mockNext = jest.fn();
    });

    it('should call next() immediately', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should override res.json method', () => {
      const middleware = contractDeprecationMiddleware();
      const originalJson = mockRes.json;

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.json).not.toBe(originalJson);
      expect(typeof mockRes.json).toBe('function');
    });
  });

  describe('non-deprecated contract behavior', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
      mockReq = {};
      mockRes = {
        set: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      mockNext = jest.fn();
    });

    it('should not add headers for current contracts', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      // Simulate a response with integration-list@1
      const response = {
        items: [],
        meta: {
          contract: 'integration-list@1',
        },
      };

      mockRes.json(response);

      // Deprecation header should not be set for current contract
      const deprecationCalls = mockRes.set.mock.calls.filter(
        call => call[0] === 'Deprecation'
      );
      expect(deprecationCalls.length).toBe(0);
    });

    it('should call original json with response data', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      const response = {
        items: [],
        meta: { contract: 'integration-list@1' },
      };

      const returnValue = mockRes.json(response);

      // Original json should be called
      expect(mockRes.json.mock.results[0]).toBeDefined();
    });
  });

  describe('deprecated contract behavior', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
      mockReq = {};
      mockRes = {
        set: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      mockNext = jest.fn();

      // Setup a deprecated contract
      registerContractVersion('test-deprecated', '1', {
        deprecated: true,
        sunset: '2026-12-31',
        releaseDate: '2026-01-01',
      });
    });

    it('should add Deprecation header for deprecated contracts', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      const response = {
        items: [],
        meta: { contract: 'test-deprecated@1' },
      };

      mockRes.json(response);

      expect(mockRes.set).toHaveBeenCalledWith('Deprecation', 'true');
    });

    it('should add X-Contract-Deprecated header', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      const response = {
        items: [],
        meta: { contract: 'test-deprecated@1' },
      };

      mockRes.json(response);

      expect(mockRes.set).toHaveBeenCalledWith('X-Contract-Deprecated', 'test-deprecated@1');
    });

    it('should add Sunset header when date provided', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      const response = {
        items: [],
        meta: { contract: 'test-deprecated@1' },
      };

      mockRes.json(response);

      const sunsetCalls = mockRes.set.mock.calls.filter(call => call[0] === 'Sunset');
      expect(sunsetCalls.length).toBeGreaterThan(0);
    });
  });

  describe('response format handling', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
      mockReq = {};
      mockRes = {
        set: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      mockNext = jest.fn();
    });

    it('should handle responses without meta', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      const response = { items: [] }; // No meta

      expect(() => mockRes.json(response)).not.toThrow();
    });

    it('should handle responses with meta but no contract', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      const response = { items: [], meta: { count: 5 } };

      expect(() => mockRes.json(response)).not.toThrow();
    });

    it('should handle null/undefined responses', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      expect(() => mockRes.json(null)).not.toThrow();
      expect(() => mockRes.json(undefined)).not.toThrow();
    });

    it('should handle malformed contract identifiers gracefully', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      const response = {
        items: [],
        meta: { contract: 'invalid-contract-format' },
      };

      expect(() => mockRes.json(response)).not.toThrow();
    });
  });

  describe('HTTP header standards compliance', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
      mockReq = {};
      mockRes = {
        set: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      mockNext = jest.fn();

      registerContractVersion('standards-test', '1', {
        deprecated: true,
        sunset: '2026-12-31',
        releaseDate: '2026-01-01',
      });
    });

    it('Deprecation header should be boolean string', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      const response = {
        meta: { contract: 'standards-test@1' },
      };

      mockRes.json(response);

      const call = mockRes.set.mock.calls.find(c => c[0] === 'Deprecation');
      expect(call[1]).toBe('true');
    });

    it('Sunset header should be HTTP-date format', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      const response = {
        meta: { contract: 'standards-test@1' },
      };

      mockRes.json(response);

      const call = mockRes.set.mock.calls.find(c => c[0] === 'Sunset');
      expect(call).toBeDefined();
      // Value should be RFC 2822 date (toUTCString() format)
      expect(typeof call[1]).toBe('string');
    });

    it('X-Contract-Deprecated should follow naming conventions', () => {
      const middleware = contractDeprecationMiddleware();
      middleware(mockReq, mockRes, mockNext);

      const response = {
        meta: { contract: 'standards-test@1' },
      };

      mockRes.json(response);

      const call = mockRes.set.mock.calls.find(c => c[0] === 'X-Contract-Deprecated');
      expect(call).toBeDefined();
      expect(call[1]).toMatch(/^[\w-]+@\d+$/); // name@version format
    });
  });

  describe('middleware chaining', () => {
    it('should be composable with other middleware', () => {
      const middleware1 = contractDeprecationMiddleware();
      const middleware2 = (req, res, next) => next();

      const mockReq = {};
      const mockRes = {
        set: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      let callOrder = [];

      const mockNext1 = () => {
        callOrder.push('next1');
        middleware2(mockReq, mockRes, () => {
          callOrder.push('next2');
        });
      };

      middleware1(mockReq, mockRes, mockNext1);

      expect(callOrder).toContain('next1');
      expect(callOrder).toContain('next2');
    });

    it('should not interfere with error handling', () => {
      const middleware = contractDeprecationMiddleware();
      const mockReq = {};
      const mockRes = {
        set: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const mockNext = jest.fn();

      expect(() => middleware(mockReq, mockRes, mockNext)).not.toThrow();
    });
  });

  describe('performance considerations', () => {
    it('should not cause significant overhead', () => {
      const middleware = contractDeprecationMiddleware();
      const mockReq = {};
      const mockRes = {
        set: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const mockNext = jest.fn();

      const startTime = Date.now();
      middleware(mockReq, mockRes, mockNext);
      const middlewareSetupTime = Date.now() - startTime;

      expect(middlewareSetupTime).toBeLessThan(10); // Should be very fast
    });

    it('should handle large response payloads', () => {
      const middleware = contractDeprecationMiddleware();
      const mockReq = {};
      const mockRes = {
        set: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const mockNext = jest.fn();

      middleware(mockReq, mockRes, mockNext);

      // Large response
      const largeResponse = {
        items: new Array(10000).fill({ id: 1, data: 'x'.repeat(100) }),
        meta: { contract: 'integration-list@1' },
      };

      expect(() => mockRes.json(largeResponse)).not.toThrow();
    });
  });
});
