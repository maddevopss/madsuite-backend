'use strict';

const crypto = require('crypto');

function signWebhook({ secret, timestamp, body }) {
  const payload = `${timestamp}.${body}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyWebhookSignature({ secret, timestamp, body, signature, now = Date.now(), toleranceMs = 300000 }) {
  if (Math.abs(now - Number(timestamp)) > toleranceMs) return false;
  const expected = signWebhook({ secret, timestamp, body });
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function nextDeliveryState(delivery, succeeded, now = new Date()) {
  if (succeeded) return { ...delivery, status: 'delivered', deliveredAt: now.toISOString() };
  const attempts = (delivery.attempts || 0) + 1;
  if (attempts >= (delivery.maxAttempts || 5)) return { ...delivery, attempts, status: 'quarantined' };
  return { ...delivery, attempts, status: 'retrying', retryAfterMs: Math.min(3600000, 1000 * (2 ** attempts)) };
}

module.exports = { signWebhook, verifyWebhookSignature, nextDeliveryState };
