const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  return error;
}

function encodeCursor(row) {
  if (!row?.created_at || row.id === undefined || row.id === null) return null;
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: String(row.id) }))
    .toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!decoded.createdAt || decoded.id === undefined || decoded.id === null) {
      throw new Error('invalid cursor');
    }
    return { createdAt: decoded.createdAt, id: String(decoded.id) };
  } catch (_error) {
    throw badRequest('pagination.cursor_invalid');
  }
}

function parseLimit(value, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  if (value === undefined || value === null || value === '') return defaultLimit;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw badRequest('pagination.limit_invalid');
  }
  return limit;
}

function parseDate(value, code) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(code);
  return date.toISOString();
}

function parseIntegrationListQuery(query = {}, options = {}) {
  const allowedSorts = options.allowedSorts || ['created_at'];
  const sort = query.sort || 'created_at';
  const direction = String(query.direction || 'desc').toLowerCase();

  if (!allowedSorts.includes(sort)) throw badRequest('pagination.sort_invalid');
  if (!['asc', 'desc'].includes(direction)) throw badRequest('pagination.direction_invalid');

  const createdFrom = parseDate(query.createdFrom, 'pagination.created_from_invalid');
  const createdTo = parseDate(query.createdTo, 'pagination.created_to_invalid');
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw badRequest('pagination.period_invalid');
  }

  return {
    limit: parseLimit(query.limit, options),
    cursor: decodeCursor(query.cursor),
    sort,
    direction,
    createdFrom,
    createdTo,
  };
}

function addCommonPaginationClauses({ clauses, values, page, alias = 'l' }) {
  if (page.createdFrom) {
    values.push(page.createdFrom);
    clauses.push(`${alias}.created_at >= $${values.length}`);
  }
  if (page.createdTo) {
    values.push(page.createdTo);
    clauses.push(`${alias}.created_at <= $${values.length}`);
  }
  if (page.cursor) {
    values.push(page.cursor.createdAt, page.cursor.id);
    const operator = page.direction === 'asc' ? '>' : '<';
    clauses.push(`(${alias}.created_at, ${alias}.id) ${operator} ($${values.length - 1}, $${values.length})`);
  }
}

function finalizePage(rows, page, extraMeta = {}) {
  const hasMore = rows.length > page.limit;
  const items = hasMore ? rows.slice(0, page.limit) : rows;
  return {
    items,
    meta: {
      count: items.length,
      limit: page.limit,
      hasMore,
      nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
      sort: page.sort,
      direction: page.direction,
      ...extraMeta,
    },
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  encodeCursor,
  decodeCursor,
  parseLimit,
  parseIntegrationListQuery,
  addCommonPaginationClauses,
  finalizePage,
};
