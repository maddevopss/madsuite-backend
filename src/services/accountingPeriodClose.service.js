'use strict';

function buildCloseChecklist({ trialBalance, unreconciledAccounts = [], draftEntries = [], integrity }) {
  const checks = [
    { code: 'trial_balance', passed: Boolean(trialBalance?.balanced) },
    { code: 'integrity', passed: Boolean(integrity?.healthy) },
    { code: 'bank_reconciliation', passed: unreconciledAccounts.length === 0, count: unreconciledAccounts.length },
    { code: 'draft_entries', passed: draftEntries.length === 0, count: draftEntries.length },
  ];
  return { checks, canClose: checks.every((check) => check.passed) };
}

function closePeriod(period, evidence) {
  const checklist = buildCloseChecklist(evidence);
  if (!checklist.canClose) throw new Error('ACCOUNTING_PERIOD_CLOSE_BLOCKED');
  return { ...period, status: 'closed', closedAt: new Date().toISOString(), closeEvidence: checklist };
}

function lockPeriod(period) {
  if (period.status !== 'closed') throw new Error('ACCOUNTING_PERIOD_MUST_BE_CLOSED');
  return { ...period, status: 'locked', lockedAt: new Date().toISOString() };
}

module.exports = { buildCloseChecklist, closePeriod, lockPeriod };
