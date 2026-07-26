const fs = require('fs');
const path = require('path');
const {
  encodeCursor,
  decodeCursor,
  parseLimit,
  parseIntegrationListQuery,
  addCommonPaginationClauses,
  finalizePage,
} = require('../utils/integrationPagination');

const continuityRoutes = fs.readFileSync(path.join(__dirname, '../routes/business/risk-continuity-links.routes.js'), 'utf8');
const institutionalRoutes = fs.readFileSync(path.join(__dirname, '../routes/business/institutional-risk-links.routes.js'), 'utf8');

describe('integration pagination contract', () => {
  test('encodes and decodes an opaque deterministic cursor', () => {
    const cursor = encodeCursor({ id: 42, created_at: '2026-07-26T12:00:00.000Z' });
    expect(cursor).not.toContain('2026-07-26');
    expect(decodeCursor(cursor)).toEqual({ createdAt: '2026-07-26T12:00:00.000Z', id: '42' });
  });

  test('enforces server-side limits', () => {
    expect(parseLimit(undefined)).toBe(25);
    expect(parseLimit('100')).toBe(100);
    expect(() => parseLimit('0')).toThrow('pagination.limit_invalid');
    expect(() => parseLimit('101')).toThrow('pagination.limit_invalid');
    expect(() => parseLimit('abc')).toThrow('pagination.limit_invalid');
  });

  test('rejects invalid cursors, sorts, directions and periods', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow('pagination.cursor_invalid');
    expect(() => parseIntegrationListQuery({ sort: 'organisation_id' })).toThrow('pagination.sort_invalid');
    expect(() => parseIntegrationListQuery({ direction: 'sideways' })).toThrow('pagination.direction_invalid');
    expect(() => parseIntegrationListQuery({ createdFrom: '2026-08-01', createdTo: '2026-07-01' })).toThrow('pagination.period_invalid');
  });

  test('builds tenant-safe common clauses with parameterized values', () => {
    const page = parseIntegrationListQuery({
      limit: '10',
      createdFrom: '2026-07-01',
      createdTo: '2026-07-31',
      cursor: encodeCursor({ id: 9, created_at: '2026-07-20T00:00:00.000Z' }),
    });
    const clauses = ['l.organisation_id=$1'];
    const values = ['org-a'];
    addCommonPaginationClauses({ clauses, values, page, alias: 'l' });

    expect(clauses[0]).toBe('l.organisation_id=$1');
    expect(clauses).toContain('l.created_at >= $2');
    expect(clauses).toContain('l.created_at <= $3');
    expect(clauses).toContain('(l.created_at, l.id) < ($4, $5)');
    expect(values[0]).toBe('org-a');
  });

  test('returns stable page metadata and a next cursor', () => {
    const page = parseIntegrationListQuery({ limit: '2' });
    const result = finalizePage([
      { id: 3, created_at: '2026-07-03T00:00:00.000Z' },
      { id: 2, created_at: '2026-07-02T00:00:00.000Z' },
      { id: 1, created_at: '2026-07-01T00:00:00.000Z' },
    ], page, { contract: 'integration-list@1' });

    expect(result.items.map((item) => item.id)).toEqual([3, 2]);
    expect(result.meta).toMatchObject({
      count: 2,
      limit: 2,
      hasMore: true,
      sort: 'created_at',
      direction: 'desc',
      contract: 'integration-list@1',
    });
    expect(decodeCursor(result.meta.nextCursor).id).toBe('2');
  });

  test.each([continuityRoutes, institutionalRoutes])('applies deterministic pagination after organisation scope', (source) => {
    expect(source).toContain("clauses = ['l.organisation_id=$1']");
    expect(source).toContain('parseIntegrationListQuery(req.query)');
    expect(source).toContain('addCommonPaginationClauses');
    expect(source).toContain('page.limit + 1');
    expect(source).toContain('l.created_at ${page.direction.toUpperCase()}, l.id ${page.direction.toUpperCase()}');
    expect(source).toContain("contract: 'integration-list@1'");
  });
});
