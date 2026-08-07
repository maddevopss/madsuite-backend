const CLASSIFICATION = {
  public: [],
  internal: ['organisation_id', 'created_by'],
  confidential: ['email', 'phone', 'address'],
  secret: ['password', 'token', 'refreshToken', 'apiKey', 'secret'],
};

function redactRecord(record = {}, allowed = ['public', 'internal']) {
  const permitted = new Set(allowed);
  return Object.entries(record).reduce((result, [key, value]) => {
    const level = Object.entries(CLASSIFICATION).find(([, fields]) => fields.includes(key))?.[0] || 'public';
    if (permitted.has(level)) result[key] = value;
    else result[key] = '[REDACTED]';
    return result;
  }, {});
}

function retentionDecision({ classification, ageDays, legalHold = false }) {
  if (legalHold) return { action: 'retain', reason: 'legal_hold' };
  const limits = { public: 3650, internal: 1095, confidential: 730, secret: 90 };
  return ageDays > limits[classification] ? { action: 'delete', reason: 'retention_expired' } : { action: 'retain', reason: 'within_retention' };
}

module.exports = { CLASSIFICATION, redactRecord, retentionDecision };