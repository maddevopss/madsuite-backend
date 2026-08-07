/**
 * Pagination Middleware
 * 
 * Provides standardized pagination for API routes
 * - Validates and sanitizes limit/page parameters
 * - Enforces min/max constraints
 * - Calculates offset for database queries
 * - Provides pagination metadata in responses
 */

/**
 * Pagination middleware factory
 * @param {Object} options - Configuration options
 * @param {number} options.defaultLimit - Default items per page (default: 20)
 * @param {number} options.maxLimit - Maximum items per page (default: 100)
 * @param {number} options.minLimit - Minimum items per page (default: 1)
 * @returns {Function} Express middleware
 */
function paginationMiddleware(options = {}) {
  const {
    defaultLimit = 20,
    maxLimit = 100,
    minLimit = 1
  } = options;

  return (req, res, next) => {
    // Parse and validate page parameter
    let page = parseInt(req.query.page) || 1;
    if (page < 1) page = 1;

    // Parse and validate limit parameter
    let limit = parseInt(req.query.limit) || defaultLimit;
    if (limit < minLimit) limit = minLimit;
    if (limit > maxLimit) limit = maxLimit;

    // Calculate offset
    const offset = (page - 1) * limit;

    // Attach pagination info to request
    req.pagination = {
      page,
      limit,
      offset,
      defaultLimit,
      maxLimit,
      minLimit
    };

    // Helper function to format paginated response
    res.paginate = (data, total) => {
      const totalPages = Math.ceil(total / limit);
      const hasNextPage = offset + limit < total;
      const hasPreviousPage = page > 1;

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage,
          hasPreviousPage,
          offset
        }
      };
    };

    next();
  };
}

/**
 * Cursor-based pagination middleware (alternative to offset)
 * Useful for large datasets where offset becomes inefficient
 * @param {Object} options - Configuration options
 * @param {number} options.defaultLimit - Default items per page (default: 20)
 * @param {number} options.maxLimit - Maximum items per page (default: 100)
 * @returns {Function} Express middleware
 */
function cursorPaginationMiddleware(options = {}) {
  const {
    defaultLimit = 20,
    maxLimit = 100
  } = options;

  return (req, res, next) => {
    // Parse and validate limit parameter
    let limit = parseInt(req.query.limit) || defaultLimit;
    if (limit < 1) limit = 1;
    if (limit > maxLimit) limit = maxLimit;

    // Get cursor (base64 encoded ID or timestamp)
    const cursor = req.query.cursor || null;

    // Attach cursor pagination info to request
    req.pagination = {
      limit,
      cursor,
      defaultLimit,
      maxLimit
    };

    // Helper function to format cursor-paginated response
    res.paginateCursor = (data, nextCursor = null) => {
      return {
        data,
        pagination: {
          limit,
          cursor,
          nextCursor,
          hasMore: nextCursor !== null
        }
      };
    };

    next();
  };
}

/**
 * Validate pagination parameters
 * @param {Object} pagination - Pagination object from middleware
 * @returns {Object} Validated pagination object
 */
function validatePagination(pagination) {
  if (!pagination || typeof pagination !== 'object') {
    throw new Error('Invalid pagination object');
  }

  if (pagination.page < 1 || pagination.limit < 1) {
    throw new Error('Page and limit must be positive integers');
  }

  if (pagination.limit > pagination.maxLimit) {
    throw new Error(`Limit cannot exceed ${pagination.maxLimit}`);
  }

  return pagination;
}

/**
 * Build SQL LIMIT/OFFSET clause
 * @param {Object} pagination - Pagination object from middleware
 * @returns {string} SQL clause (e.g., "LIMIT 20 OFFSET 0")
 */
function buildLimitOffsetClause(pagination) {
  return `LIMIT ${pagination.limit} OFFSET ${pagination.offset}`;
}

/**
 * Build SQL cursor WHERE clause
 * @param {string} cursorColumn - Column name to use for cursor (e.g., 'id', 'created_at')
 * @param {string} cursor - Cursor value
 * @param {string} direction - 'after' or 'before' (default: 'after')
 * @returns {string} SQL WHERE clause
 */
function buildCursorWhereClause(cursorColumn, cursor, direction = 'after') {
  if (!cursor) return '';

  const operator = direction === 'after' ? '>' : '<';
  return `AND ${cursorColumn} ${operator} '${cursor}'`;
}

module.exports = {
  paginationMiddleware,
  cursorPaginationMiddleware,
  validatePagination,
  buildLimitOffsetClause,
  buildCursorWhereClause
};
