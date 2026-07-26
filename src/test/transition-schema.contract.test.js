const {
  TransitionValidationError,
  requireText,
  requireEvidence,
  requireIdempotencyKey,
  validateTransitionInput,
  businessError,
} = require('../utils/transitionSchema');

function request(body = {}, header = null) {
  return { body, get: (name) => (name === 'Idempotency-Key' ? header : null) };
}

describe('transition schema contract', () => {
  test('normalizes justification, evidence and idempotency', () => {
    expect(validateTransitionInput(request({
      rationale: '  Décision vérifiée  ',
      evidence: [{ type: 'document', id: 'p-1' }],
    }, 'transition-123'))).toEqual({
      input: {
        rationale: 'Décision vérifiée',
        evidence: [{ type: 'document', id: 'p-1' }],
      },
      idempotencyKey: 'transition-123',
    });
  });

  test('rejects invalid transition inputs with stable codes', () => {
    expect(() => requireText({}, 'rationale')).toThrow(TransitionValidationError);
    expect(() => requireEvidence({ evidence: [] })).toThrow('transition.evidence_required');
    expect(() => requireEvidence({ evidence: new Array(21).fill({}) })).toThrow('transition.evidence_too_many');
    expect(() => requireIdempotencyKey(request({}, 'abc'))).toThrow('transition.idempotency_key_invalid');
  });

  test('supports optional evidence and structured errors', () => {
    expect(validateTransitionInput(request({ rationale: 'Justification' }, 'transition-456'), {
      requireEvidence: false,
    })).toEqual({ input: { rationale: 'Justification' }, idempotencyKey: 'transition-456' });

    const error = new TransitionValidationError('transition.evidence_required', { field: 'evidence' });
    expect(businessError(error)).toEqual({
      code: 'transition.evidence_required',
      message: 'transition.evidence_required',
      details: { field: 'evidence' },
    });
  });
});
