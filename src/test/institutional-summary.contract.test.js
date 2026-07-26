const { buildInstitutionalSummary } = require('../services/business/institutional-summary.service');

describe('institutional summary contract', () => {
  test('returns a bounded, versioned and organisation-scoped summary', async () => {
    const values = [8, 2, 3, 4, 5, 6, 7, 1200, 300];
    const queries = [];
    const db = {
      query: jest.fn(async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [{ value: values.shift() }] };
      }),
    };

    const result = await buildInstitutionalSummary(db, 'org-a');

    expect(result).toEqual({
      generatedAt: expect.any(String),
      contract: 'institutional-summary@1',
      risks: { open: 8, critical: 2 },
      continuity: { activePlans: 3 },
      audit: { overdueFindings: 4, overdueActions: 5 },
      performance: { objectivesAtRisk: 6, overdueImprovementPlans: 7 },
      finance: { receivables: 1200, payables: 300, netExposure: 900 },
    });
    expect(db.query).toHaveBeenCalledTimes(9);
    expect(queries.every(({ sql, params }) => sql.includes('organisation_id=$1') && params[0] === 'org-a')).toBe(true);
    expect(queries.every(({ sql }) => !sql.includes('SELECT *'))).toBe(true);
  });
});
