'use strict';

const { transitionExtension } = require('../platform/extensions/extensionLifecycle');

describe('stage 12E extension lifecycle', () => {
  test('requires compatibility before activation', () => {
    expect(() => transitionExtension({ currentState: 'installed', nextState: 'active', approvedBy: 'human', compatibility: { compatible: false } })).toThrow('core compatibility');
  });

  test('requires a tested rollback plan', () => {
    expect(() => transitionExtension({ currentState: 'active', nextState: 'rollback_pending', approvedBy: 'human', rollbackPlan: { tested: false } })).toThrow('tested rollback');
  });
});
