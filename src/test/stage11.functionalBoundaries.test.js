'use strict';

const { validateFunctionalBoundaries } = require('../core/scaling/functionalBoundaries');

describe('functional boundaries', () => {
  it('accepts explicit contracts without circular dependencies', () => {
    expect(validateFunctionalBoundaries([
      { name: 'billing', contracts: ['invoice@1'], events: ['invoice.finalized'], dependsOn: [] },
      { name: 'payments', contracts: ['payment@1'], events: ['payment.received'], dependsOn: ['billing'] },
    ]).valid).toBe(true);
  });

  it('refuses distribution without demonstrated gain', () => {
    expect(() => validateFunctionalBoundaries([
      { name: 'billing', contracts: [], events: [], distributed: true },
    ])).toThrow('distribution_without_demonstrated_gain:billing');
  });
});
