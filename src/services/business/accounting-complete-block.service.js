'use strict';

function evaluateAccountingClosure(input = {}) {
  const debits = Number(input.trialBalanceDebits || 0);
  const credits = Number(input.trialBalanceCredits || 0);
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const snapshots = Array.isArray(input.statementSnapshotIds) ? input.statementSnapshotIds : [];

  const checks = {
    balanced: debits === credits,
    entriesResolved: Number(input.unresolvedEntries || 0) === 0,
    reconciliationsResolved: Number(input.unresolvedReconciliations || 0) === 0,
    evidencePresent: evidence.length > 0,
    statementsPresent: snapshots.length >= 3,
    approvalPresent: Boolean(input.approvedBy),
  };

  const failures = Object.keys(checks).filter((name) => !checks[name]);
  return { allowed: failures.length === 0, checks, failures, difference: debits - credits };
}

module.exports = { evaluateAccountingClosure };
