'use strict';

function validateDataScalePlan(plan = {}) {
  const required = ['table', 'indexStrategy', 'archivePolicy', 'retentionPolicy', 'migrationMode'];
  for (const field of required) if (!plan[field]) throw new Error(`data_scale_field_required:${field}`);
  if (!['online', 'expand-contract', 'shadow-copy'].includes(plan.migrationMode)) {
    throw new Error('unsafe_migration_mode');
  }
  if (plan.partitioning && !plan.partitionKey) throw new Error('partition_key_required');
  if (plan.historicalRead === false && plan.retentionPolicy !== 'delete-approved') {
    throw new Error('historical_read_must_be_preserved');
  }
  return { contract: 'data-scale-plan@1', approved: true, interruptionManaged: true };
}

module.exports = { validateDataScalePlan };
