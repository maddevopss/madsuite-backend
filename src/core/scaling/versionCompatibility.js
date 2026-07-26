'use strict';

function validateCompatibilityWindow(contract = {}) {
  const required = ['name', 'currentVersion', 'supportedVersions', 'deprecationDate'];
  for (const field of required) if (!contract[field]) throw new Error(`compatibility_field_required:${field}`);
  if (!Array.isArray(contract.supportedVersions) || !contract.supportedVersions.includes(contract.currentVersion)) {
    throw new Error('current_version_not_supported');
  }
  if (contract.breakingChange === true && !contract.migrationPlan) throw new Error('breaking_change_requires_migration_plan');
  if (contract.downMigrationRealistic === true && !contract.downMigrationTested) throw new Error('down_migration_not_tested');
  return { contract: 'version-compatibility@1', valid: true, compatibilityWindowOpen: true };
}

module.exports = { validateCompatibilityWindow };
