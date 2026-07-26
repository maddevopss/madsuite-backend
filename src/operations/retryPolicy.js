function computeRetry({ attempt = 0, maxAttempts = 5, baseDelayMs = 1000, maxDelayMs = 300000 } = {}) {
  const nextAttempt = Number(attempt) + 1;
  if (!Number.isInteger(nextAttempt) || nextAttempt < 1 || maxAttempts < 1) throw new Error('retry.policy.invalid');
  if (nextAttempt > maxAttempts) {
    return { contract: 'retry-decision@1', action: 'quarantine', attempt: nextAttempt, delayMs: null };
  }
  const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (nextAttempt - 1)));
  return { contract: 'retry-decision@1', action: 'retry', attempt: nextAttempt, delayMs };
}

function quarantineRecord({ id, reason, actor, now = new Date() } = {}) {
  if (!id || !reason || !actor) throw new Error('quarantine.record.invalid');
  return Object.freeze({ contract: 'quarantine-record@1', id: String(id), reason: String(reason), actor: String(actor), quarantinedAt: now.toISOString(), releasedAt: null });
}

function releaseQuarantine(record, { actor, justification, now = new Date() } = {}) {
  if (!record || record.contract !== 'quarantine-record@1' || !actor || !String(justification || '').trim()) throw new Error('quarantine.release.invalid');
  return { ...record, releasedAt: now.toISOString(), releasedBy: String(actor), releaseJustification: String(justification).trim() };
}

module.exports = { computeRetry, quarantineRecord, releaseQuarantine };
