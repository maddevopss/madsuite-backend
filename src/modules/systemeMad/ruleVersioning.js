'use strict';

function createRuleVersion(input) {
  return Object.freeze({
    ruleId: input.ruleId,
    version: String(input.version || '1.0.0'),
    contentHash: String(input.contentHash || ''),
    effectiveAt: input.effectiveAt || new Date().toISOString(),
    supersedes: input.supersedes || null,
    approvedBy: input.approvedBy || null,
  });
}

module.exports = { createRuleVersion };
