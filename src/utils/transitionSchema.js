class TransitionValidationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'TransitionValidationError';
    this.statusCode = 400;
    this.code = code;
    this.details = details;
  }
}

function requireText(input, field, { min = 1, max = 2000 } = {}) {
  const value = typeof input?.[field] === 'string' ? input[field].trim() : '';
  if (value.length < min) {
    throw new TransitionValidationError(`transition.${field}_required`, { field, min });
  }
  if (value.length > max) {
    throw new TransitionValidationError(`transition.${field}_too_long`, { field, max });
  }
  return value;
}

function requireEvidence(input, { field = 'evidence', minItems = 1, maxItems = 20 } = {}) {
  const value = input?.[field];
  if (!Array.isArray(value) || value.length < minItems) {
    throw new TransitionValidationError('transition.evidence_required', { field, minItems });
  }
  if (value.length > maxItems) {
    throw new TransitionValidationError('transition.evidence_too_many', { field, maxItems });
  }
  return value;
}

function requireIdempotencyKey(req, input = req?.body || {}) {
  const value = req?.get?.('Idempotency-Key') || input.idempotencyKey;
  if (typeof value !== 'string' || value.trim().length < 8 || value.trim().length > 200) {
    throw new TransitionValidationError('transition.idempotency_key_invalid', {
      field: 'Idempotency-Key',
      min: 8,
      max: 200,
    });
  }
  return value.trim();
}

function validateTransitionInput(req, options = {}) {
  const input = { ...(req?.body || {}) };
  const justificationField = options.justificationField || 'rationale';

  input[justificationField] = requireText(input, justificationField, {
    min: options.justificationMin || 3,
    max: options.justificationMax || 2000,
  });

  if (options.requireEvidence !== false) {
    input.evidence = requireEvidence(input, options.evidenceOptions);
  }

  const idempotencyKey = requireIdempotencyKey(req, input);
  return { input, idempotencyKey };
}

function businessError(error) {
  return {
    code: error?.code || error?.message || 'transition.invalid',
    message: error?.message || 'La transition a été refusée.',
    details: error?.details || {},
  };
}

module.exports = {
  TransitionValidationError,
  requireText,
  requireEvidence,
  requireIdempotencyKey,
  validateTransitionInput,
  businessError,
};
