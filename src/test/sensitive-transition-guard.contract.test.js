const { guardSensitiveTransition } = require('../security/sensitiveTransitionGuard');

describe('sensitive transition guard', () => {
  test('refuse auto-approbation', () => {
    expect(() => guardSensitiveTransition({ actor: { id: 1 }, resource: { created_by: 1 }, payload: { action: 'approve' }, idempotencyKey: 'abc' })).toThrow(expect.objectContaining({ code: 'transition.self_approval_forbidden' }));
  });

  test('refuse une élévation fournie par le client', () => {
    expect(() => guardSensitiveTransition({ actor: { id: 1 }, resource: { created_by: 2 }, payload: { role: 'admin' }, idempotencyKey: 'abc' })).toThrow(expect.objectContaining({ code: 'transition.client_authority_forbidden' }));
  });

  test('refuse le rejeu', () => {
    expect(() => guardSensitiveTransition({ actor: { id: 1 }, resource: { created_by: 2 }, payload: {}, idempotencyKey: 'abc', replayed: true })).toThrow(expect.objectContaining({ code: 'transition.replay_detected' }));
  });
});