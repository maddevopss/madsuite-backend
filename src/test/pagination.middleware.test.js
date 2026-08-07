/**
 * Tests for pagination middleware
 * 
 * Validates:
 * - Parameter validation (page, limit)
 * - Min/max constraints
 * - Offset calculation
 * - Response formatting
 * - Multi-tenant scope
 */

const { paginationMiddleware, buildLimitOffsetClause } = require('../middleware/pagination.middleware');

describe('Pagination Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { query: {} };
    res = {};
    next = jest.fn();
  });

  describe('paginationMiddleware', () => {
    it('should use default values when no parameters provided', () => {
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(1);
      expect(req.pagination.limit).toBe(20);
      expect(req.pagination.offset).toBe(0);
      expect(next).toHaveBeenCalled();
    });

    it('should parse page and limit from query parameters', () => {
      req.query = { page: '2', limit: '50' };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(2);
      expect(req.pagination.limit).toBe(50);
      expect(req.pagination.offset).toBe(50);
    });

    it('should enforce minimum page value of 1', () => {
      req.query = { page: '0' };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(1);
    });

    it('should enforce minimum limit value', () => {
      req.query = { limit: '0' };
      const middleware = paginationMiddleware({ minLimit: 1, defaultLimit: 1 });
      middleware(req, res, next);

      expect(req.pagination.limit).toBe(1);
    });

    it('should enforce maximum limit value', () => {
      req.query = { limit: '200' };
      const middleware = paginationMiddleware({ maxLimit: 100 });
      middleware(req, res, next);

      expect(req.pagination.limit).toBe(100);
    });

    it('should calculate correct offset for page 3 with limit 20', () => {
      req.query = { page: '3', limit: '20' };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.offset).toBe(40);
    });

    it('should handle negative page values', () => {
      req.query = { page: '-5' };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(1);
    });

    it('should handle non-numeric page values', () => {
      req.query = { page: 'abc' };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(1);
    });

    it('should provide res.paginate helper function', () => {
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(typeof res.paginate).toBe('function');
    });

    it('should format paginated response correctly', () => {
      req.query = { page: '1', limit: '20' };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      const data = [{ id: 1 }, { id: 2 }];
      const response = res.paginate(data, 100);

      expect(response.data).toEqual(data);
      expect(response.pagination.page).toBe(1);
      expect(response.pagination.limit).toBe(20);
      expect(response.pagination.total).toBe(100);
      expect(response.pagination.totalPages).toBe(5);
      expect(response.pagination.hasNextPage).toBe(true);
      expect(response.pagination.hasPreviousPage).toBe(false);
    });

    it('should indicate no next page on last page', () => {
      req.query = { page: '5', limit: '20' };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      const response = res.paginate([], 100);

      expect(response.pagination.hasNextPage).toBe(false);
      expect(response.pagination.hasPreviousPage).toBe(true);
    });

    it('should handle custom default limit', () => {
      const middleware = paginationMiddleware({ defaultLimit: 50 });
      middleware(req, res, next);

      expect(req.pagination.limit).toBe(50);
    });

    it('should handle custom max limit', () => {
      req.query = { limit: '500' };
      const middleware = paginationMiddleware({ maxLimit: 200 });
      middleware(req, res, next);

      expect(req.pagination.limit).toBe(200);
    });
  });

  describe('buildLimitOffsetClause', () => {
    it('should build correct SQL LIMIT/OFFSET clause', () => {
      const pagination = { limit: 20, offset: 0 };
      const clause = buildLimitOffsetClause(pagination);

      expect(clause).toBe('LIMIT 20 OFFSET 0');
    });

    it('should build clause with non-zero offset', () => {
      const pagination = { limit: 20, offset: 40 };
      const clause = buildLimitOffsetClause(pagination);

      expect(clause).toBe('LIMIT 20 OFFSET 40');
    });

    it('should handle large limits', () => {
      const pagination = { limit: 100, offset: 1000 };
      const clause = buildLimitOffsetClause(pagination);

      expect(clause).toBe('LIMIT 100 OFFSET 1000');
    });
  });

  describe('Multi-tenant scope', () => {
    it('should maintain organisation_id in pagination context', () => {
      req.query = { page: '1', limit: '20' };
      req.organisationId = 'org-123';
      
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      // Pagination should not interfere with organisation context
      expect(req.pagination.page).toBe(1);
      expect(req.organisationId).toBe('org-123');
    });

    it('should work with RLS-scoped queries', () => {
      req.query = { page: '2', limit: '25' };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      // Pagination offset should be correct for RLS-filtered results
      expect(req.pagination.offset).toBe(25);
      expect(req.pagination.limit).toBe(25);
    });
  });

  describe('Edge cases', () => {
    it('should handle page 1 with limit 1', () => {
      req.query = { page: '1', limit: '1' };
      const middleware = paginationMiddleware({ minLimit: 1 });
      middleware(req, res, next);

      expect(req.pagination.offset).toBe(0);
      expect(req.pagination.limit).toBe(1);
    });

    it('should handle very large page numbers', () => {
      req.query = { page: '999999', limit: '20' };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(999999);
      expect(req.pagination.offset).toBe((999999 - 1) * 20);
    });

    it('should handle float page values', () => {
      req.query = { page: '2.5', limit: '20' };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(2);
      expect(req.pagination.offset).toBe(20);
    });

    it('should handle empty query object', () => {
      req.query = {};
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(1);
      expect(req.pagination.limit).toBe(20);
      expect(req.pagination.offset).toBe(0);
    });

    it('should handle null query parameters', () => {
      req.query = { page: null, limit: null };
      const middleware = paginationMiddleware();
      middleware(req, res, next);

      expect(req.pagination.page).toBe(1);
      expect(req.pagination.limit).toBe(20);
    });
  });

  describe('Performance', () => {
    it('should calculate pagination quickly', () => {
      const middleware = paginationMiddleware();
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        req.query = { page: String(i), limit: '20' };
        middleware(req, res, next);
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should complete in < 100ms
    });
  });
});
