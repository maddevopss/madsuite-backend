const { listResponse, resourceResponse } = require('../utils/integrationResponseContract');

const continuityRoutes = require('fs').readFileSync(require('path').join(__dirname, '../routes/business/risk-continuity-links.routes.js'), 'utf8');
const institutionalRoutes = require('fs').readFileSync(require('path').join(__dirname, '../routes/business/institutional-risk-links.routes.js'), 'utf8');

describe('stable integration response contracts', () => {
  test('normalizes list responses', () => {
    expect(listResponse([{ id: 1 }])).toEqual({ items: [{ id: 1 }], meta: { count: 1 } });
    expect(listResponse(null)).toEqual({ items: [], meta: { count: 0 } });
  });

  test('normalizes resource responses', () => {
    expect(resourceResponse({ id: 1 }, { contract: 'integration-resource@1' })).toEqual({
      resource: { id: 1 },
      meta: { contract: 'integration-resource@1' },
    });
  });

  test.each([continuityRoutes, institutionalRoutes])('uses versioned contracts in integration routes', (source) => {
    expect(source).toContain("contract: 'integration-list@1'");
    expect(source).toContain("contract: 'integration-resource@1'");
    expect(source).toContain('finalizePage');
    expect(source).toContain('resourceResponse');
  });
});
