function evaluateDeployment({ prechecks = [], postchecks = [], migration = {}, rollback = {} } = {}) {
  const allPrechecksPass = prechecks.length > 0 && prechecks.every(Boolean);
  const allPostchecksPass = postchecks.length > 0 && postchecks.every(Boolean);
  const migrationSafe = migration.reversible === true || Boolean(migration.compensationPlan);
  const rollbackReady = rollback.tested === true && Boolean(rollback.targetVersion);
  return {
    contract: 'deployment-gate@1',
    deployAllowed: allPrechecksPass && migrationSafe && rollbackReady,
    promoteAllowed: allPrechecksPass && allPostchecksPass && migrationSafe && rollbackReady,
    rollbackRequired: allPrechecksPass && !allPostchecksPass,
  };
}

module.exports = { evaluateDeployment };
