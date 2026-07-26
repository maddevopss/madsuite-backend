'use strict';

const PRIORITY_WEIGHTS = { critical: 100, high: 50, medium: 20, low: 5 };

function evaluateTechnicalDebt(entry = {}) {
  const required = ['id', 'component', 'risk', 'owner', 'retirementCriteria'];
  for (const field of required) if (!entry[field]) throw new Error(`technical_debt_field_required:${field}`);
  const priority = PRIORITY_WEIGHTS[entry.risk];
  if (!priority) throw new Error('invalid_technical_debt_risk');
  if (entry.retireNow === true && !entry.activeConsumerProof) throw new Error('active_consumer_proof_required');
  if (entry.retireNow === true && entry.activeConsumers > 0) throw new Error('active_consumers_would_break');
  return { contract: 'technical-debt-registry@1', priority, retirementAllowed: entry.retireNow === true };
}

module.exports = { evaluateTechnicalDebt };
