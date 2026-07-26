const { encodeCursor, decodeCursor, parseIntegrationListQuery, finalizePage } = require('../utils/integrationPagination');

describe('integration pagination volume contract', () => {
  test('walks a large deterministic data set without duplicate or omission', () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({
      id: 250 - index,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 250 - index)).toISOString(),
    }));

    const seen = [];
    let offset = 0;
    let cursor = null;

    while (offset < rows.length) {
      const page = parseIntegrationListQuery({ limit: '37', cursor });
      const result = finalizePage(rows.slice(offset, offset + page.limit + 1), page);
      seen.push(...result.items.map((item) => item.id));
      offset += result.items.length;
      cursor = result.meta.nextCursor;

      if (!result.meta.hasMore) break;
      expect(decodeCursor(cursor).id).toBe(String(seen[seen.length - 1]));
    }

    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
    expect(seen).toEqual(rows.map((row) => row.id));
  });

  test('keeps cursor payload limited to ordering fields', () => {
    const cursor = encodeCursor({
      id: 7,
      created_at: '2026-07-26T00:00:00.000Z',
      organisation_id: 'must-not-leak',
      rationale: 'must-not-leak',
    });
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    expect(decoded).toEqual({ createdAt: '2026-07-26T00:00:00.000Z', id: '7' });
  });
});
