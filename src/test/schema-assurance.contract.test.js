const { inspectSchema, assertSchema } = require('../operations/schemaAssurance');

describe('schema assurance contract', () => {
  const requirements = [
    { kind: 'table', name: 'outbox_events' },
    { kind: 'index', name: 'idx_outbox_pending' },
    { kind: 'policy', name: 'outbox_tenant_policy', repairable: false },
  ];

  test('accepts a complete schema', () => {
    const report = inspectSchema(requirements, {
      table: ['outbox_events'],
      index: ['idx_outbox_pending'],
      policy: ['outbox_tenant_policy'],
    });
    expect(report.valid).toBe(true);
    expect(assertSchema(report)).toBe(true);
  });

  test('separates repairable and blocking gaps', () => {
    const report = inspectSchema(requirements, { table: [] });
    expect(report.valid).toBe(false);
    expect(report.repairable.map((item) => item.name)).toEqual(expect.arrayContaining(['outbox_events', 'idx_outbox_pending']));
    expect(report.blocked).toEqual([expect.objectContaining({ name: 'outbox_tenant_policy' })]);
    expect(() => assertSchema(report)).toThrow('schema.incomplete');
  });
});
