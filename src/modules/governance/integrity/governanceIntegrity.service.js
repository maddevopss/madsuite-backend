'use strict';

const crypto = require('crypto');

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function computeIntegrityHash(payload) {
  return crypto.createHash('sha256').update(stableSerialize(payload)).digest('hex');
}

function signGovernanceRecord(payload, secret) {
  if (!secret) throw new TypeError('signature_secret_required');
  const hash = computeIntegrityHash(payload);
  const signature = crypto.createHmac('sha256', secret).update(hash).digest('hex');
  return Object.freeze({ algorithm: 'HMAC-SHA256', hash, signature });
}

function verifyGovernanceRecord(payload, envelope, secret) {
  if (!envelope?.hash || !envelope?.signature || !secret) return false;
  const expected = signGovernanceRecord(payload, secret);
  const hashMatches = crypto.timingSafeEqual(Buffer.from(expected.hash), Buffer.from(envelope.hash));
  const signatureMatches = crypto.timingSafeEqual(Buffer.from(expected.signature), Buffer.from(envelope.signature));
  return hashMatches && signatureMatches;
}

module.exports = { stableSerialize, computeIntegrityHash, signGovernanceRecord, verifyGovernanceRecord };
