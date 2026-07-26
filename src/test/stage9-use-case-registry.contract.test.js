const { createUseCaseRegistry } = require('../ai/assistedUseCaseRegistry');

describe('stage 9A assisted use cases', () => {
  const approved = { id: 'billing-review', version: 1, owner: 'finance', status: 'approved', autonomy: 'advisory', dataClasses: ['invoice-summary'], riskLevel: 'medium' };
  test('activates only approved and versioned use cases', () => {
    const registry = createUseCaseRegistry([approved, { ...approved, id: 'payroll-action', status: 'forbidden' }]);
    expect(registry.canActivate('billing-review', 1)).toBe(true);
    expect(registry.canActivate('payroll-action', 1)).toBe(false);
    expect(registry.canActivate('unknown', 1)).toBe(false);
  });
  test('rejects autonomous authority', () => {
    expect(() => createUseCaseRegistry([{ ...approved, autonomy: 'autonomous' }])).toThrow('ai.use_case.autonomy_invalid');
  });
});
